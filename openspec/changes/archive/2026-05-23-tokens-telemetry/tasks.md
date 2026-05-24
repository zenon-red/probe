## 0. Cross-repo Prerequisites

- [x] 0.1 In **nexus/stdb**: add `input_tokens` / `output_tokens` to `AgentAction`; extend `report_action_run_finished`; run `cargo check` and existing tests; publish module to dev/staging
- [x] 0.2 In **probe**: regenerate `src/module_bindings/*` from published stdb schema
- [x] 0.3 In **nexus/frontend**: regenerate `src/spacetime/generated/*` from published stdb schema

## 1. Essential State

- [x] 1.1 Append `input_tokens` and `output_tokens` at **end** of `AgentAction` (after `harness`) with `#[default(0u64)]` — required for automatic migration
- [x] 1.1b Coordinate publish: stdb + regenerated probe bindings + probe daemon + frontend bindings in one rollout (`report_action_run_finished` arity change breaks old clients)
- [x] 1.2 Extend `report_action_run_finished` in `nexus/stdb/src/reducers/dispatch/report.rs` to accept and persist both fields
- [x] 1.3 Update `nexus/stdb` seed/dev fixtures if any `AgentAction` literals need the new fields

## 2. Essential Logic

- [x] 2.1 Create `probe/src/daemon/harness-usage.ts` with `extractHarnessUsage(harness, actionId, runStartedAt)` contract
- [x] 2.2 Implement marker search (`zenon.red{action:<id>}`) and mtime disambiguation per harness data root
- [x] 2.3 Implement pi JSONL parser (scoped assistant `usage` sum)
- [x] 2.4 Implement hermes parser: row totals when single marker in session; JSON snapshot message-level sum when multiple markers; else `0`/`0`
- [x] 2.4b Return `0`/`0` for `custom` and unknown harness without parsing
- [x] 2.5 Implement opencode per-message JSON parser (`step-finish` tokens)
- [x] 2.6 Implement openclaw transcript/metadata parser
- [x] 2.7 Add `tests/unit/harness-usage.test.ts` with fixture snippets per harness (success + miss + scoped range)

## 3. Accidental State and Control

- [ ] 3.1 (Optional) Add `harnessDataRoots` to probe config for lab audit path overrides — defer if not needed for MVP

## 4. Feeders and Observers

- [x] 4.1 Wire `probe/src/daemon/action-executor.ts`: capture `runStartedAt` before harness, call `extractHarnessUsage` after exit, pass tokens to `reportActionRunFinished`
- [x] 4.2 Regenerate probe `module_bindings` (task 0.2) and verify TypeScript compiles
- [x] 4.3 Add or extend `useAgentActions` (or `useAgent`) subscription to `agent_actions` for profile `agent_id` in **nexus/frontend**
- [x] 4.4 Add `formatTokenCount` / `formatDurationSecs` helpers in **nexus/frontend** `src/lib/format.ts` (or equivalent)
- [x] 4.5 Add Operations aggregates (`useMemo`, coalesce tokens with `?? 0`) and `InlineStat` row on **nexus/frontend** `AgentProfilePage.tsx`
- [ ] 4.6 Manual smoke: agent with harness runs shows Runs, Time worked, Tokens in/out on profile
- [x] 4.7 Update `probe/openspec/specs/probe.md` and `probe/docs/commands.md` for token reporting (on archive/sync or alongside implementation)
