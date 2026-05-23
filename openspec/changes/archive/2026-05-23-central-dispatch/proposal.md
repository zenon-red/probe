## Why

Three converging problems have a single root cause: routing happens in N independent local processes instead of one central place. The daemon holds ~2 GiB RSS subscribing to 15 unbounded tables it doesn't need. The daemon and scheduler are completely decoupled, requiring per-harness cron adapters and manual setup. N independent local routers produce race conditions on task claims, no load balancing, no capability-aware routing, and no central policy control. Moving coordination into SpacetimeDB solves all three simultaneously.

## What Changes

- **BREAKING**: `probe next` command removed — routing is now central in SpacetimeDB
- **BREAKING**: `src/utils/next-router.ts` removed — all routing logic moves to STDB Rust
- **BREAKING**: `issue_agent_action` reducer removed — agents no longer self-issue actions
- **BREAKING**: `src/utils/runtime-detection.ts` and `src/utils/scheduler-plans.ts` removed — no external cron needed
- **BREAKING**: `--scheduler` and `--wake-interval` flags removed from `probe onboard`
- **BREAKING**: `schedulerConfirmed` and `wakeIntervalMs` config fields removed

- **New**: `dispatch_tick_schedule` scheduled table in STDB — drives periodic general-work dispatch
- **New**: `dispatch_runs` table in STDB — records each non-disabled scheduled dispatch run and provides action trigger provenance
- **New**: `dispatch_tick` reducer — evaluates route/work queues, selects eligible agents, and issues actions
- **New**: route-centric central dispatch logic — evaluates route/work queues in STDB, selects deterministic targets, and assigns eligible agents
- **New**: `issue_action` internal function — invariant gate for action issuance (duplicate suppression, cadence, liveness, one-active-per-agent)
- **New**: `ActionRequest` / `IssueResult` types for action issuance
- **New**: Central task assignment during action issuance — open tasks are atomically assigned by STDB before an `ExecuteTask` action is issued
- **New**: Idea backlog homeostasis — `Propose` is issued only when active idea backlog is below target, not as an unconditional idle fallback
- **New**: Peer review pipeline — task PRs receive configurable peer reviews (default 3), each review is independently validated, then Zoe receives merge-ready work
- **New**: Task review state tables — `TaskReview` and `TaskReviewValidation` track review authorship, validation, and merge readiness
- **New**: Review action completion commands — `probe action review` and `probe action validate-review` record review outcomes atomically with action completion
- **New**: Action recovery policy — stuck issued/running actions expire so agents and tasks can be retried
- **New**: Prompt-injection boundary — action instructions are trusted dispatch text; untrusted messages/GitHub/repo content stays target context, not executable instruction
- **New**: `AgentRunOutcome` enum — infrastructure outcome reporting (Clean, Signal, Timeout, SpawnFailed)
- **New**: `set_dispatch_cooldown` reducer — per-agent cadence control persisted in STDB
- **New**: `dispatch_cooldown_secs` and `last_heartbeat_at` fields on Agent table
- **New**: Executable intent fields on `agent_actions` — `skill`, `instruction`, `trigger_type`, `trigger_id`, `route`, and run metadata fields
- **Modified**: Action kinds change for central dispatch — `ExecuteTask`, `ReviewTask`, `ValidateReview`, and `MergeReadyTask` replace legacy claim/continue/validate routing actions
- **New**: `probe action show/complete/fail/skip/review/validate-review` commands — action lifecycle CLI
- **New**: `probe agent cooldown show/set/off/inherit` commands — cadence control CLI
- **New**: Harness auto-detection in daemon — auto-detects pi/hermes/openclaw/opencode from PATH
- **New**: Narrow subscriptions — daemon: own agent + own `agent_actions` (filter `Issued` client-side); other commands: explicit per-command table lists; default `agents` + `config` only
- **New**: Daemon dispatch loop — execute issued actions one-at-a-time, spawn harness, report run metadata
- **New**: Harness config fields — `harness`, `harnessCommand`, `harnessArgs`, `harnessTimeoutSecs`

- **Modified**: `agent_actions` table gains executable intent, trigger/cause, and run metadata fields
- **Modified**: `agents` table gains `dispatch_cooldown_secs`, `last_heartbeat_at`
- **Modified**: `heartbeat` reducer updates `last_heartbeat_at`
- **Modified**: `init` reducer bootstraps dispatch schedule and config defaults
- **Modified**: `update_agent_action` reducer no longer sets `Agent.status = Working`
- **Modified**: Daemon heartbeat interval changes from 60s to 5 min (lightweight liveness proof, not keepalive; no heartbeat-failure-driven reconnect)
- **Modified**: `callReducer` / `callProcedure` use typed SDK reducers instead of string names
- **Modified**: `probe onboard` replaces scheduler step with harness detection (non-interactive; no onboard cooldown flag — cadence via `probe agent cooldown` after onboard, guided by zenon.red join docs)

## Capabilities

### New Capabilities
- `central-dispatch`: Server-side scheduled dispatch — dispatch tick reducer, routing logic, action issuance invariant gate, cadence policy, dispatch config
- `daemon-executor`: Daemon as generic action executor — narrow subscriptions, harness auto-detection, one-at-a-time action execution, infrastructure run metadata reporting
- `action-cli`: Action lifecycle CLI commands — `probe action show/complete/fail/skip/review/validate-review`
- `agent-cooldown`: Per-agent cadence control — `probe agent cooldown show/set/off/inherit`, persisted in STDB

### Modified Capabilities
- `probe`: Onboard (scheduler → harness, non-interactive, no onboard cooldown), removed commands (`next`), subscription narrowing, typed reducers, new config fields (harness), removed config fields (schedulerConfirmed, wakeIntervalMs)

## Impact

**SpacetimeDB (nexus/stdb):**
- New files: dispatch module (tick, route selection, issue, cooldown), dispatch schedule/run tables, task review/validation tables
- Modified files: agent table, agent_action table, types, heartbeat reducer, init reducer, actions module (delete issue.rs)
- New config keys: `dispatch_interval_secs`, `dispatch_enabled`, `heartbeat_stale_secs`, `dispatch_cooldown_secs`, `idea_backlog_target`, `proposal_scout_max_in_flight`, `action_issue_timeout_secs`, `action_run_timeout_secs`, `task_review_required_count`, `review_validation_required_count`

**Probe CLI:**
- New files: `src/commands/action.ts`, harness detection logic
- Deleted files: `src/commands/next.ts`, `src/utils/next-router.ts`, `src/utils/next-action-defs.ts`, `src/utils/runtime-detection.ts`, `src/utils/scheduler-plans.ts`
- Modified files: `src/commands/nexus-daemon.ts`, `src/utils/context.ts`, `src/types/config.ts`, `src/commands/onboard.ts`, `src/utils/onboard/steps.ts`

**Documentation/Skills:**
- Updated: `skills/probe/SKILL.md`, command docs, getting-started, zenon.red join page (ask operator for work cadence; map to `probe agent cooldown` after onboard), zr-* skill files

**No external dependency changes.** SpacetimeDB SDK 2.1.0 already supports scheduled reducers. No new crates or npm packages needed.
