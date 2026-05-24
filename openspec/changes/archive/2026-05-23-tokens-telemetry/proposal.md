## Why

Central Dispatch already records harness duration, outcome, and harness name per action, but operators still cannot see **how much model usage** each agent consumes. Token totals are available in harness session stores after every run; we need to extract them once, persist on `agent_actions`, and surface aggregates on the agent profile.

## What Changes

- **New (STDB)**: `input_tokens` and `output_tokens` columns on `agent_actions` (default `0`)
- **Modified (STDB)**: `report_action_run_finished` accepts `input_tokens` and `output_tokens`
- **New (probe)**: `harness-usage.ts` — post-run session lookup via `zenon.red{action:<id>}`, per-harness parsers, non-throwing extractor contract
- **Modified (probe)**: `action-executor.ts` calls extractor after `runHarness` and passes tokens to finish reducer
- **New (probe)**: Unit tests with per-harness fixture snippets
- **Modified (probe)**: Regenerate `module_bindings` after STDB publish; update `openspec/specs/probe.md` and `docs/commands.md`
- **New (frontend)**: Operations stats on `AgentProfilePage` — runs, time worked, infra failures, avg run, harness, tokens in/out (client-side aggregates over `agent_actions`)
- **Modified (frontend)**: Regenerate spacetime bindings after schema

**Explicitly out of scope:** cache/reasoning token columns, cost/estimated spend, stdout JSONL modes, per-action token drill-down, `agent_run_events` table.

**Already shipped:** Correlation marker `zenon.red{action:<id>}` as prompt line 1 (`action-prompts.ts`, `prompt-builder.ts`).

## Capabilities

### New Capabilities

_(none — per `openspec/config.yaml`, all requirements merge into `probe` on archive/sync)_

### Modified Capabilities

- `probe`: STDB `input_tokens` / `output_tokens` on `agent_actions`; `#[default(0)]` schema migration; post-run session-store extraction (`pi`, `hermes`, `opencode`, `openclaw`; `custom` → `0`/`0`); daemon reports tokens via `report_action_run_finished`; frontend Operations aggregates on agent profile

## Impact

| Repo / area | Files |
|-------------|-------|
| `nexus/stdb` | `agent_action.rs`, `report.rs`, publish + bindings regen |
| `probe` | `harness-usage.ts`, `action-executor.ts`, `module_bindings/*`, tests, docs |
| `nexus/frontend` | `AgentProfilePage.tsx`, hooks/subscription, `format.ts` helpers, `spacetime/generated/*` |
| Dev lab (later) | Reuses same extractor against audit mounts (`prd-dev-lab.md` Phase 4) |

**Trust model:** Self-reported daemon stats (same as run duration); not billing-grade.
