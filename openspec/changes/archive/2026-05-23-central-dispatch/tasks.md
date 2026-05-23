## 0. Cross-repo Prerequisites

- [x] 0.1 Create openspec change in **nexus/stdb** for central dispatch STDB module — dispatch schedule/run tables, route-centric dispatch tick reducer, route-specific action issuance, cooldown reducer, agent/action table migrations, task review/validation tables, review completion reducers, init bootstrap, heartbeat update
- [x] 0.2 Create openspec change in **zenon.red** for updated join page — remove `probe next` as manual step, add daemon/cooldown guidance, instruct agents to ask operator for work cadence and run `probe agent cooldown` after onboard (no onboard cooldown flag)
- [x] 0.3 Create openspec change in **skills** (zenon-red/skills) for updated zr-* SKILL.md files — replace `probe next` with `probe action`, remove cron references

## 1. Essential State — Probe Config and Types

- [x] 1.1 Add harness config fields to `NexusConfig` in `src/types/config.ts`: `harness`, `harnessCommand`, `harnessArgs`, `harnessTimeoutSecs`
- [x] 1.2 Remove `schedulerConfirmed` and `wakeIntervalMs` from `NexusConfig` in `src/types/config.ts`

## 2. Essential Logic — Harness Detection and Action Commands

- [x] 2.1 Create harness auto-detection utility in `src/utils/harness-detection.ts` — detect pi/hermes/openclaw/opencode from PATH and known directories, return detection result with harness ID and command array
- [x] 2.2 Create `src/commands/action.ts` — implement `probe action show <id>`, `probe action complete <id>`, `probe action fail <id> --reason "..."`, `probe action skip <id> --reason "..."`, `probe action review <id> --outcome <approved|changes-requested> --summary "..."`, and `probe action validate-review <id> --outcome <valid|invalid> --summary "..."` subcommands
- [x] 2.3 Create `src/commands/agent-cooldown.ts` — implement `probe agent cooldown show`, `probe agent cooldown set <secs>`, `probe agent cooldown off`, `probe agent cooldown inherit` subcommands
- [x] 2.4 Create prompt builder utility — function that takes an AgentAction row and produces the harness prompt string (action id, skill, kind, route, target, trigger, trusted instruction, security boundary, route-specific completion commands)

## 2A. Cross-repo STDB Dispatch Scope

- [x] 2A.1 Add STDB tables/types: `DispatchRun`, `DispatchRoute`, `TaskReview`, `TaskReviewValidation`, `TaskReviewStatus`, `TaskReviewOutcome`, `TaskReviewValidationOutcome`
- [x] 2A.2 Add route-centric `dispatch_tick` implementation — evaluate routes first, select deterministic targets, then select eligible agents by fairness ordering
- [x] 2A.3 Add route-specific eligibility/uniqueness/reservation rules — votes, task assignment/continuation, peer review, review validation, merge-ready work, project/task setup, discoveries, proposal scout
- [x] 2A.4 Add central task assignment for `AssignOpenTask` — verify task dispatchability, dependencies, active project, no existing reservation, then assign task and issue `ExecuteTask` atomically
- [x] 2A.5 Add peer review dispatch pipeline — issue required peer reviews, issue review validations, and route merge-ready tasks to Zoe after quorum
- [x] 2A.6 Add review completion reducers — complete `ReviewTask` by inserting `TaskReview`; complete `ValidateReview` by inserting `TaskReviewValidation`; update action/event lifecycle atomically
- [x] 2A.7 Add action recovery policy — expire issued-not-started, over-timeout, and stale-agent active actions before new issuance
- [x] 2A.8 Add dispatch config seeding — dispatch interval/enabled, heartbeat stale 900s, cooldown, idea backlog target, proposal scout in-flight limit, action timeouts, review quorum counts
- [x] 2A.9 Add prompt-injection boundary in STDB action construction — trusted instruction only, no raw untrusted messages/GitHub/repo/web content in `AgentAction.instruction`
- [x] 2A.10 Ensure personal/chat messages are not automatic dispatch inputs; only authorized directives and validated future structured handoffs may wake agents

## 3. Accidental State and Control — Daemon Rewrite

- [x] 3.1 Modify `src/utils/context.ts` — `subscribe: string[]` and `subscribeFactory`; default `agents` + `config` only; per-command explicit subscriptions; typed `callReducer`/`callProcedure`
- [x] 3.2 Rewrite `src/commands/nexus-daemon.ts` — two-phase narrow subscriptions (own agent, then own `agent_actions` by `agent_id`; filter `Issued` client-side — STDB cannot filter enums in SQL), 5-min heartbeat timer, on action insert spawn harness one-at-a-time with timeout, report infrastructure run metadata (`run_started_at`, `run_finished_at`, `run_outcome`, `run_duration_secs`, `harness`)
- [x] 3.3 Add harness spawn logic to daemon — build command array from detected/configured harness, spawn with `shell: false`, wait for exit, handle timeout with process kill, map exit to `AgentRunOutcome`

## 4. Cleanup — Remove Old Code and Update Onboard

- [x] 4.1 Delete `src/commands/next.ts`
- [x] 4.2 Delete `src/utils/next-router.ts`
- [x] 4.3 Delete `src/utils/next-action-defs.ts`
- [x] 4.4 Delete `src/utils/runtime-detection.ts`
- [x] 4.5 Delete `src/utils/scheduler-plans.ts`
- [x] 4.6 Update `src/commands/onboard.ts` — replace `--scheduler` with `--harness`; no `--cooldown` (cadence via `probe agent cooldown` after onboard)
- [x] 4.7 Update `src/utils/onboard/steps.ts` — replace `configureScheduler` with `configureHarness` (detect harness, write config); remain non-interactive
- [x] 4.8 Update `src/index.ts` — remove `next` registration, add `action` and `agent cooldown` subcommands
