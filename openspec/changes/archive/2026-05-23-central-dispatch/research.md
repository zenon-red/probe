> **Note:** This document is a pre-migration codebase snapshot (2026-05-22). It describes the old `probe next` / 15-table daemon architecture. For target behavior, see `design.md`, `proposal.md`, and the capability specs in this change.

## Codebase Exploration

### Current Architecture

The system has two disconnected subsystems that perform one job — deciding what an agent should work on and executing it:

**Local routing** (`probe next` + `next-router.ts`): A 250-line priority cascade runs client-side in TypeScript. Each agent independently scans the full SpacetimeDB cache of tasks, ideas, votes, messages, and channels to pick one action. The router is pure (no side effects) and deterministic given the same cache state. It returns a `NextAction` with `kind`, `target`, `reason_code`, and `skill`.

**Daemon** (`nexus-daemon.ts`): A persistent SpacetimeDB WebSocket connection that heartbeats every 60s and optionally logs table mutations. It subscribes to all 15 tables unconditionally (`SELECT * FROM` on each). It does not route or execute — it only observes and heartbeats.

**Scheduler** (`runtime-detection.ts`, `scheduler-plans.ts`): External cron (hermes, openclaw, or manual) calls `probe next` periodically. Each wake creates a new connection, subscribes to all 15 tables, runs the router, persists the action via `issue_agent_action`, and outputs JSON. The agent's harness reads the output and executes the skill.

**Self-issue model** (`issue.rs`): Agents call `issue_agent_action` to issue actions to themselves. Auth requires `agent.identity == ctx.sender()`. There is no central dispatcher. Each agent decides its own `ActionKind` and self-reports completion.

### SpacetimeDB Schema (nexus/stdb)

20 tables, 2.1.0 SDK with `unstable` feature. Key tables:

- **`Agent`**: `id`, `name`, `role`, `capabilities`, `status`, `identity`, `last_heartbeat`, `current_task_id`, `onboarded_at`. No `dispatch_cooldown_secs` field.
- **`AgentAction`**: `id` (auto), `agent_id`, `kind` (ActionKind enum), `target_type`, `target_id`, `reason_code`, `status` (ActionStatus enum), `created_at`, `updated_at`. No `skill`, `instruction`, `trigger_type`, or run metadata fields. Indexes on `(agent_id)` and `(agent_id, created_at)` — no index on `status`.
- **`ActionKind`**: 11 variants — `Repair`, `Inbox`, `Vote`, `Propose`, `ContinueTask`, `ClaimTask`, `ProjectSetup`, `CreateTasks`, `ValidateReviews`, `ReviewDiscovery`, `Idle`.
- **`ActionStatus`**: 5 variants — `Issued`, `Completed`, `Skipped`, `Failed`, `Expired`.
- **`Config`**: Simple key-value store. Currently seeds activity/scoring thresholds. No dispatch config keys.

The SDK supports scheduled reducers via `#[table(scheduled(reducer_name))]` with a `scheduled_at: ScheduleAt` field — confirmed in the 2.1.0 SDK test fixtures.

### Memory Problem

The daemon subscribes to `SELECT * FROM` on 15 tables. The SpacetimeDB SDK maintains a full in-memory replica in `TableCacheImpl.rows` — an unbounded `Map` that grows monotonically. Tables like `messages`, `project_messages`, and `agent_actions` have no TTL or compaction. The daemon only reads its own agent row but holds all 15 tables.

Root cause: `src/utils/context.ts` — `CommandContext.create` hardcodes all 15 subscriptions. `withAuth` triggers this for every connection.

### State Classification

**Essential state** (system cannot function without it):
- Agent identity, role, capabilities, liveness status
- Tasks, ideas, votes, projects, messages — the coordination data
- Action instructions (what to do, why, for whom)
- Per-agent cadence policy (cost control for operators)
- Dispatch config (enabled, interval, stale thresholds)

**Essential derived data** (computed from essential state, re-derive on demand):
- Which agent should get which action (routing decision)
- Whether an agent is eligible for dispatch (heartbeat fresh, not busy, cadence allows)
- Whether a task is claimable (open, no blockers)
- Action priority ordering

**Accidental state** (correct without it, just slower):
- The daemon's full 15-table cache — the daemon only needs its own agent row and its issued actions
- `agent_actions` historical rows — completed/failed/skipped actions are logs, not working state
- The local `next-router.ts` routing cache

**Accidental derived data**:
- The sorted task list used by each agent's local router
- Per-agent "has this agent voted on this idea" computed by scanning the votes table

## Sources

- **SpacetimeDB Rust SDK 2.1.0**: Scheduled reducers via `#[table(scheduled(...))]` with `ScheduleAt` type. Confirmed in `spacetimedb-lib` exports and SDK test fixtures (`crates/bindings/tests/ui/reducers.rs`).
- **SpacetimeDB SDK docs** (line 5308): _"Applications where these resources are a constraint should register more precise queries via subscribe."_
- **Probe codebase**: `src/utils/context.ts:156–172` (unconditional subscriptions), `src/commands/nexus-daemon.ts` (daemon lifecycle), `src/utils/next-router.ts` (routing cascade), `src/commands/next.ts` (one-shot dispatch entry point).
- **Nexus STDB codebase**: `src/tables/agent_action.rs` (current action schema), `src/reducers/actions/issue.rs` (self-issue reducer), `src/reducers/agent/heartbeat.rs` (heartbeat writes `last_heartbeat`).

## Approach A: Server-Side Dispatch with Scheduled Reducer

Move all routing into SpacetimeDB. A scheduled reducer (`dispatch_tick`) runs every N seconds, evaluates route/work queues centrally, assigns eligible agents, and inserts `agent_actions` rows. The daemon subscribes only to its own agent row and its issued actions. On action insert, the daemon spawns the configured harness with the action instruction.

The daemon becomes a generic executor: subscribe narrow → receive action → spawn harness → report outcome. No routing, no full-table cache, no local scheduler.

## Approach B: Hybrid — Server-Side Routing, Client-Side Execution Control

Keep routing in SpacetimeDB but let the daemon control when it asks for work. The daemon periodically calls a `request_work` reducer instead of subscribing to a schedule. SpacetimeDB computes and returns an action atomically. The daemon still does narrow subscriptions but actively polls for work rather than passively receiving it.

## Approach C: Daemon-Side Routing with Narrow Subscriptions

Keep routing in the daemon but fix the memory problem. The daemon subscribes to a narrow set of tables (its own agent, actions for its agent, plus lightweight queries for tasks/ideas/votes). It runs `chooseNext` locally every N seconds using a timer instead of external cron. No SpacetimeDB changes needed — just fix the subscriptions and add a timer.

## Recommended Approach

**Approach A** — Server-side dispatch with scheduled reducer.

The PRD's three converging problems (memory, disconnected systems, uncoordinated routing) all trace to the same root: routing happens in N independent local processes instead of one central place. Approach A solves all three simultaneously. Approach B leaves polling logic in the daemon and doesn't eliminate the two-system split. Approach C fixes memory but preserves race conditions, no-load-balancing, and no-capability-routing problems.

The SpacetimeDB 2.1.0 SDK supports scheduled reducers natively. The existing `next-router.ts` shows the historical work categories, but central dispatch replaces the local agent-centric router with route-centric server-side coordination, assignment, review quorum, and action issuance. The `issue_agent_action` reducer already exists and its self-issue model naturally becomes server-issue with auth changes.

## Trade-offs

**What Approach A gives up:**
- Agents can no longer self-dispatch. Every action must come through the central tick or a future intentional-wakeup reducer. An agent cannot independently decide "I want to work on X now" without the server agreeing.
- Routing policy changes require a STDB module redeploy instead of just a probe CLI upgrade. This is actually a benefit (central control) but adds deployment friction for routing experiments.
- The scheduled tick introduces latency. An action may wait up to `dispatch_interval_secs` before being assigned. Approach C had zero dispatch latency (instant `probe next`).

**Edge cases and failure modes:**
- **Approach A**: Slow dispatch tick blocks other STDB writes (reducers are transactional). A tick that scans many agents/tables could create contention. Mitigation: keep the tick fast with proper indexes, and the kill switch (`dispatch_enabled = false`).
- **Approach B**: The `request_work` reducer has the same contention risk, plus adds a round-trip per work request. No improvement over A.
- **Approach C**: Still has race conditions on task claims (two agents claim simultaneously). Still has no capability-aware routing. Memory is fixed but coordination problems remain.

**Future flexibility:**
- **Approach A** explicitly reserves room for intentional wakeups (direct messages, human directives, PR comments) issuing actions immediately through the same `issue_action` path. The scheduled tick is for general backlog; it is not the only dispatch source.
- **Approach B** could support wakeups but the polling model is awkward for push-based notifications.
- **Approach C** has no server-side coordination point for wakeups — each agent would still independently decide.
