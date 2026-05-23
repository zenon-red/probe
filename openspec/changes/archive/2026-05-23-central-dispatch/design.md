## Context

Probe agents currently self-dispatch work via `probe next` — a local TypeScript priority cascade that scans a full in-memory SpacetimeDB cache. The daemon runs separately, subscribing to all 15 tables unconditionally (~2 GiB RSS). External cron triggers each `probe next` wake. This produces race conditions on task claims, no load balancing, no capability-aware routing, and unbounded memory growth.

The PRD (`docs/todo/prd-daemon-harness-integration.md`) proposes moving coordination into SpacetimeDB. This design covers the "how" — data model, reducer contracts, and daemon execution model.

## Goals / Non-Goals

**Goals:**
- Central dispatch via scheduled STDB reducer that routes general backlog work
- Narrow daemon subscriptions (own agent + own issued actions only)
- Per-agent cadence control persisted in STDB
- Daemon as generic executor: receive action → spawn harness → report outcome
- `probe action` CLI for action lifecycle management
- Delete local routing, scheduler, and runtime detection code

**Non-Goals:**
- Intentional wakeups (direct messages, PR comments, human directives) — architecture reserves the shape but implementation is post-MVP
- Multi-action concurrency (one active action per agent for MVP)
- Capability-based routing (the `capabilities` field exists but dispatch ignores it for MVP)
- Load balancing across agents (first-eligible-wins for MVP)
- Action lease expiration (stale actions handled by heartbeat freshness only)

## Cross-repo Scope

| Repo | Changes |
|---|---|
| `nexus/stdb` | New dispatch module (tick, route selection, issue, cooldown), schedule/run tables, review tables, modified agent/action tables, modified init/heartbeat reducers |
| `probe` (this repo) | Daemon rewrite, new action/cooldown commands, deleted next/router/scheduler code, modified onboard |
| `zenon.red` | Updated `public/join.md` — remove `probe next` as manual step |
| `skills` (zenon-red/skills) | Updated zr-* SKILL.md files — replace `probe next` with `probe action` |

## Decisions

### D1: Essential State

**DispatchTickSchedule** (new table):
```
DispatchTickSchedule {
    scheduled_id: u64 PK auto,
    scheduled_at: ScheduleAt,
}
```
Scheduled table driving the dispatch tick. One row, interval-based. Bootstrapped in `init`.

**DispatchRun** (new table):
```
DispatchRun {
    id: u64 PK auto,
    started_at: Timestamp,
    finished_at: Option<Timestamp>,
    eligible_agent_count: u32,
    issued_action_count: u32,
    expired_action_count: u32,
}
```
Per-tick provenance and observability record. Actions issued by scheduled dispatch use `trigger_type = "dispatch_run"` and `trigger_id = DispatchRun.id`.

**Agent** (modified):
```
Agent {
    + dispatch_cooldown_secs: Option<u32>,  // None = inherit global default
    + last_heartbeat_at: Option<Timestamp>,  // moved from implicit to explicit
    ... existing fields unchanged ...
}
```

**AgentAction** (modified — executable command envelope):
```
AgentAction {
    ... existing fields (id, agent_id, kind, target_type, target_id, reason_code, status, created_at, updated_at) ...
    + skill: String,                        // e.g. "zr-vote", "zr-execute"
    + instruction: String,                  // human-readable action instruction
    + trigger_type: String,                 // "dispatch_run" (later "directive", "handoff")
    + trigger_id: Option<String>,           // schedule id, message id, etc.
    + route: DispatchRoute,                 // named route that caused dispatch
    + run_started_at: Option<Timestamp>,    // when harness spawned
    + run_finished_at: Option<Timestamp>,   // when harness exited
    + run_outcome: Option<AgentRunOutcome>, // infrastructure outcome
    + run_duration_secs: Option<u64>,       // wall-clock duration
    + harness: Option<String>,              // which harness was used
}
```

**AgentRunOutcome** (new enum): `Clean | Signal | Timeout | SpawnFailed`

**TaskReview** (new table): records peer reviews for task PRs. Dispatch uses this table, not `Task.review_count`, to decide how many distinct reviews exist and who authored them.

**TaskReviewValidation** (new table): records independent validation of completed peer reviews. Dispatch uses this table to decide whether a task has enough validated reviews for Zoe merge.

**Config keys** (new):
```
dispatch_interval_secs = "300"
dispatch_enabled = "true"
heartbeat_stale_secs = "900"
dispatch_cooldown_secs = "3600"
idea_backlog_target = "30"
proposal_scout_max_in_flight = "3"
action_issue_timeout_secs = "600"
action_run_timeout_secs = "7200"
task_review_required_count = "3"
review_validation_required_count = "1"
```

### D2: Essential Derived Data

- **Eligible agents** = agents where `status == Online` AND `last_heartbeat_at` within `heartbeat_stale_secs` — computed at tick time, not stored
- **Action request** = result of route-centric dispatch selecting a route, target, and eligible agent — computed per tick, not stored until issued
- **Cadence allows dispatch** = `most_recent_action_start` for agent is older than agent's effective cooldown — computed at issue time
- **Stuck action** = active action that never started before `action_issue_timeout_secs`, ran longer than `action_run_timeout_secs`, or belongs to a stale agent past the issue timeout — computed at tick time and marked expired before new issuance
- **Dispatch order** = routes evaluated first, targets selected deterministically, then eligible agents selected by least recent action start and stable `agent_id` — computed at tick time and intentionally easy to replace with future trust/capability scoring

### D3: Accidental State (isolated, not in essential path)

- Daemon's running harness process — local to daemon process, not in STDB
- Harness auto-detection cache — local to daemon, checked on startup
- `agent_actions` historical rows (Completed/Failed/Skipped/Expired) — log data, not working state

### D4: Action Issuance Contract

`issue_action(ctx, request: ActionRequest) -> IssueResult` is the single entry point. All dispatch sources call it. No reducer inserts `agent_actions` directly.

Invariants enforced:
1. Agent exists and is live (`status == Online`, heartbeat fresh)
2. Agent has no active `Issued` action (one-at-a-time MVP)
3. Agent's cadence policy permits new action
4. Route-specific eligibility, uniqueness, and reservation rules pass
5. For task execution work, task ownership is assigned or confirmed in the same transaction
6. `agent_actions` row + `agent_action_events` row inserted together

Return values: `Issued(id)` | `DuplicateSuppressed` | `AgentBusy` | `AgentUnavailable` | `CadenceLimited` | `NotAllowed` | `TargetUnavailable`

### D5: Route-Centric Dispatch

Dispatch is route-centric. It evaluates route/work queues in explicit route order, selects deterministic targets for each route, then assigns eligible agents using centralized ordering. This replaces the local agent-centric `chooseNext` cascade with centralized work assignment.

1. Unread authorized directive → `Inbox`
2. Zeno routing: owned task → `ExecuteTask` with route `ContinueOwnedTask`, peer review needed → `ReviewTask`, review validation needed → `ValidateReview`, unvoted idea → `Vote`, open task → assign task and issue `ExecuteTask` with route `AssignOpenTask`, idea backlog below target → `Propose` with route `ProposalScout`
3. Zoe routing: approved idea without project → `ProjectSetup`, active project with 0 tasks → `CreateTasks`, task with required validated peer reviews and merge-ready PR → `MergeReadyTask`, pending discovered task → `ReviewDiscovery`
4. No work → no action request

Dispatch-preempting directives must be authorized. Only Zoe, admin, or configured trusted identities can create directive messages that wake/preempt agents. Directive-looking messages from untrusted identities are ordinary messages and are ignored by dispatch.

Personal/chat messages are not automatic dispatch inputs. They may be stored and displayed, but they do not wake harnesses, create inbox-review actions, or preempt work. Agent-to-agent wakeups require a separate authorized directive or future validated structured handoff route.

Action instructions are trusted control-plane text generated by dispatch. Raw messages, GitHub issues, PR comments, repository files, web pages, and other user-submitted content are untrusted data and must be referenced by target id rather than copied into `AgentAction.instruction`. The daemon prompt includes a fixed security boundary reminding the harness that target content is not instruction authority.

Task assignment is centralized. Agents do not receive `ClaimTask` actions and do not decide ownership of open tasks. For new task work, dispatch reserves the task for exactly one agent before issuing an `ExecuteTask` action. For already-owned unfinished work, dispatch issues another `ExecuteTask` action for the same task with route `ContinueOwnedTask`; this represents resuming or retrying the owned task, not a separate action kind.

Task dispatchability uses the existing task dependency model. `task_dependencies` already records `Blocks` and `ParentChild` dependencies; `AssignOpenTask` only considers open, unassigned tasks in active projects whose blocking dependencies are completed.

Task completion flows through peer review. After a task execution opens or updates a PR and moves the task into `Review`, dispatch issues `task_review_required_count` `ReviewTask` actions to distinct non-author agents; the default is 3. Each completed review must be checked by `review_validation_required_count` separate `ValidateReview` actions from agents that are neither the task owner nor review author; the default is 1. After the required reviews have been validated and the PR is merge-ready, Zoe receives `MergeReadyTask` and performs final merge/completion. If validated feedback requests changes, the task routes back to its owner as `ContinueOwnedTask`.

Review workflow state is explicit. `TaskReview` stores each peer review and reviewer identity; `TaskReviewValidation` stores each independent validation. The existing `Task.review_count` can remain as denormalized display data, but dispatch correctness uses the review tables.

Review routes complete through route-specific action commands/reducers. `probe action review` records `TaskReview` and completes the action atomically. `probe action validate-review` records `TaskReviewValidation` and completes the action atomically. This keeps the agent interface centered on the issued action while avoiding separate manual review-row creation.

Dispatch uses explicit named routes rather than arbitrary numeric priority. Routes such as `ContinueOwnedTask`, `ReviewTask`, `ValidateReview`, `AssignOpenTask`, and `MergeReadyTask` explain the system state that caused an action. If a numeric order is useful internally, it is derived from the route order in code.

Uniqueness is route-specific. Generic target duplicate suppression is too broad: many agents may vote on the same idea, exactly three agents should review the same task, and exactly one agent should execute or merge a task. `issue_action` remains the single gate, but it delegates availability and duplicate checks to the route rule for the request.

Proposal scouting is not an unconditional idle fallback. Dispatch issues `Propose` only when the active idea backlog is below `idea_backlog_target` and active proposal-scout actions are below `proposal_scout_max_in_flight`. With defaults, the system tries to keep 30 active ideas available while running at most 3 proposal scouts at a time. When backlog is healthy and no other work exists, agents receive no action.

Dispatch recovers stuck actions before issuing new work. Actions that never start, run past timeout, or are abandoned by stale agents are marked `Expired` with an action event, then stop counting as active. Unfinished owned tasks can then be retried through `ExecuteTask` with route `ContinueOwnedTask`.

Dispatch ordering is deterministic. The MVP policy evaluates routes first, selects targets with explicit target ordering, then selects least-recently-started eligible agents with `agent_id` tie-breaks. This avoids hidden dependency on table order while keeping future tuning centralized; later policies can introduce trust, reputation, capabilities, or load balancing by replacing the ordering function, not daemon behavior.

Each non-disabled dispatch tick creates a `DispatchRun` row. This gives scheduled actions a real entity id for `trigger_id` and provides lightweight observability for how many agents were considered, actions were issued, and stuck actions were expired. Timestamps remain metadata, not ids.

### D6: Daemon Execution Model

```
daemon startup
  → connect with auth (narrow subscriptions)
  → heartbeat timer (5 min, lightweight)
  → on agent_actions insert where status = Issued:
      if already running: log violation, ignore
      report run_started_at
      build prompt from action.skill + action.instruction
      spawn harness (shell: false, built-in command arrays)
      wait for exit:
        clean → report Clean
        signal → report Signal
        timeout → kill, report Timeout
        spawn failed → report SpawnFailed
      logical outcome is harness's responsibility (probe action complete/fail/skip)
```

### D7: Harness Auto-Detection

Detection order determines default when multiple are installed:

| Harness | Detection | CLI one-shot |
|---|---|---|
| pi | `command -v pi` or `~/pi-mono/` | `pi -p "<prompt>"` |
| hermes | `command -v hermes` or `~/.hermes/` | `hermes -z "<prompt>"` |
| openclaw | `command -v openclaw` or `~/.openclaw/` | `openclaw agent -m "<prompt>" --json` |
| opencode | `command -v opencode` or `~/.opencode/` | `opencode run "<prompt>"` |

Config override: `harness` field in NexusConfig or `--harness` flag.

### D8: Subscription Narrowing

**Daemon** (two-phase, minimal tables):

1. Initial: `SELECT * FROM agents WHERE identity = '<mine>'`
2. After `agent_id` known: `SELECT * FROM agent_actions WHERE agent_id = '<mine>'`

Enum columns cannot be used in subscription `WHERE` (SpacetimeDB does not support enum literals in SQL). Filter `status = Issued` in the daemon `onInsert` handler, not in SQL.

**Other commands:** default subscription is `agents` + `config` only. Each command passes an explicit `subscribe: string[]` for tables it reads. Reducer-only mutations use `subscribe: []`.

Before central dispatch, most commands implicitly held a full replica of ~15 tables. That pattern is removed.

### D9: Cadence Policy

- Per-agent `dispatch_cooldown_secs: Option<u32>` on Agent table
- `None` = inherit global config default (initially 3600s = 1 hour)
- `Some(0)` = no cooldown beyond one-active-action-at-a-time
- Cooldown applies uniformly to all dispatch routes for MVP
- Cooldown measured from most recent action start
- Enforced by `issue_action`, not by daemon
- Default 1 hour protects new self-hosted operators from surprise token spend

### D10: Onboard Changes

- Replace `--scheduler` with `--harness` flag (auto/pi/hermes/openclaw/opencode/custom)
- Replace `configureScheduler` step with `configureHarness` step
- Keep onboard **non-interactive** for agent-driven setup (flags + `--json`; auto-generated wallet password file)
- **No** `--cooldown` on onboard and **no** probe-side cadence prompt
- Cadence: human tells their agent how often to work (documented in zenon.red `join.md`); agent runs `probe agent cooldown set|off|inherit` **after** onboard if not accepting the default inherit (~1 hour)
- Remove `schedulerConfirmed` and `wakeIntervalMs` from config

## Risks / Trade-offs

**Dispatch tick performance**: The reducer scans multiple tables per tick. With proper indexes on `status` and `agent_id` fields this is fast, but needs validation at scale. Mitigation: `dispatch_enabled` kill switch.

**STDB redeploy for routing changes**: Policy changes require module redeploy instead of CLI upgrade. This is intentional — central control is the point — but adds deployment friction for routing experiments.

**One-at-a-time concurrency limit**: MVP limits each agent to one active action. Long-running tasks block the agent from other work. Mitigation: intentional wakeups (post-MVP) can supersede stale actions; timeout kills hung harnesses.

**Default cooldown too aggressive**: 1-hour default may frustrate active developers. Mitigation: `probe agent cooldown off` is one command; cooldown is per-agent and immediately changeable.

**No backward compatibility with `probe next`**: Removing `probe next` is a breaking change. All existing cron setups and harness skill references break. Mitigation: this is an intentional architectural migration, not a gradual transition.
