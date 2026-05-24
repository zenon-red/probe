## Context

Central Dispatch records harness run metadata on `agent_actions` but not token usage. Harnesses persist sessions to disk with per-message or per-session usage fields. Probe already embeds `zenon.red{action:<id>}` as the first line of every harness prompt for grep-based correlation.

This change spans three repos: STDB schema/reducer, probe extraction + reporting, frontend profile aggregates.

## Goals / Non-Goals

**Goals:**

- Persist `input_tokens` and `output_tokens` on each action when a harness run finishes
- Extract totals post-run from harness session stores (not stdout)
- Show Operations aggregates on `AgentProfilePage`
- Share extraction logic with future dev lab audit validation

**Non-Goals:**

- Cost, cache, or reasoning token columns
- Per-action token drill-down in MVP
- `agent_run_events` table
- stdout JSONL modes (`pi --mode json`)
- Changing harness spawn arguments

## Cross-repo Scope

| Repo | Work |
|------|------|
| `nexus/stdb` | Add columns; extend `report_action_run_finished`; publish module |
| `probe` | `harness-usage.ts`, wire `action-executor`, bindings regen, unit tests, docs |
| `nexus/frontend` | Subscribe `agent_actions` for profile agent; Operations `InlineStat` row; format helpers |

STDB must publish before probe/frontend binding regeneration.

## Essential State

**Relation: `agent_actions`** (extend existing row)

| Attribute | Type | Constraint |
|-----------|------|------------|
| `input_tokens` | `u64` | `#[default(0)]` on publish; finish reducer sets on each run |
| `output_tokens` | `u64` | `#[default(0)]` on publish; finish reducer sets on each run |

**Schema migration (publish strategy)** — per SpacetimeDB [automatic migrations](https://spacetimedb.com/docs/databases/automatic-migrations) and [default values](https://spacetimedb.com/docs/tables/default-values) (also in `~/research/spacetimedb/docs/`):

- Append `input_tokens` and `output_tokens` **at the end** of `AgentAction` (after `harness`). Mid-table inserts are forbidden.
- Mark both with `#[default(0)]`. On republish, existing rows are auto-filled with `0` (no backfill reducer).
- Columns without defaults cannot be added via automatic migration.
- Extending `report_action_run_finished` with two new args is a **potentially breaking reducer change**: old probe binaries calling the previous arity will get runtime errors until upgraded. Ship stdb + probe + frontend bindings in one coordinated rollout (hot-swap keeps connections; clients must match reducer signatures).
- Alternative if split deploy is required: add a new reducer (e.g. `report_action_run_finished_v2`) — not planned for MVP; coordinated deploy is simpler.
- Dev-only escape hatch: `spacetime publish --clear-database` (destroys data; not for production).
- Publish stdb → `spacetime generate` for probe `module_bindings` and frontend `spacetime/generated`.
- Frontend: `u64` fields bind as `bigint`; aggregates use `?? 0n` / `Number()` as needed.

Existing run fields unchanged: `run_started_at`, `run_finished_at`, `run_outcome`, `run_duration_secs`, `harness`.

**Integrity:**

- When `run_finished_at` is set, `input_tokens` and `output_tokens` SHALL be present (may be `0`)
- Tokens are infrastructure-layer facts; logical `status` (Completed/Failed/Skipped) remains skill-reported separately

**Not stored:** correlation marker (lives only in harness prompt), full session transcripts.

## Essential Logic

**Pure function: `extractHarnessUsage(harness, actionId, runStartedAt) → { inputTokens, outputTokens }`**

Given harness type, action id, and run start time:

1. Marker = `zenon.red{action:<actionId>}`
2. Search harness session data root for files containing marker
3. If multiple hits, select file with newest mtime ≥ `runStartedAt`
4. Parse usage from correlated session; if artifact contains multiple `zenon.red{action:` markers, sum only from the matching marker until the next marker or EOF (line/message-level scoping)
5. If `harness` is `custom` or not in the supported set (`pi`, `hermes`, `opencode`, `openclaw`), return `{0, 0}` immediately
6. Return summed input and output; on any failure return `{0, 0}`

**Per-harness parse rules:**

| Harness | Root | Fields |
|---------|------|--------|
| pi | `~/.pi/agent/sessions/` | JSONL assistant `message.usage.input` / `.output` |
| hermes | `~/.hermes/state.db` (+ `~/.hermes/sessions/*.json` when needed) | Single-marker: `sessions` row totals. Multi-marker: message-level usage in JSON snapshots (not row totals) |
| opencode | `~/.local/share/opencode/` (`storage/message/`, `storage/part/`, `opencode.db`) | `step-finish` parts → `tokens.input`/`output`; single-marker sessions → `session.tokens_input`/`tokens_output` |
| openclaw | `~/.openclaw/sessions/` | `usage.input`, `usage.output` |

**Profile aggregates** (client, over rows where `run_started_at != null`):

- Runs = count
- Time worked = sum(`run_duration_secs`)
- Infra failures = count where `run_outcome` ∈ {Signal, Timeout, SpawnFailed}
- Avg run = sum(duration) / runs
- Harness = most recent non-null `harness`
- Tokens in = sum(`input_tokens`); Tokens out = sum(`output_tokens`)

## Accidental State & Control

- **Optional config `harnessDataRoots`**: override default `~/.pi`, `~/.hermes`, etc. for dev lab audit mounts — correctness unchanged if omitted
- **Grep + mtime disambiguation**: performance hint when multiple sessions match marker; not required for correctness when only one match exists
- **Streaming parse**: read files line-by-line / message-by-message; accumulate counts without retaining full session in memory

## Feeders / Observers

**Feeder (probe daemon):**

1. `report_action_run_started` (existing)
2. `runHarness` (existing)
3. `extractHarnessUsage` → `report_action_run_finished(..., input_tokens, output_tokens)`

**Observer (frontend):**

- Subscribe `agent_actions` for profile `agent_id`
- Derive Operations stats; render on `AgentProfilePage`

## Decisions

| Decision | Essential / Accidental | Rationale |
|----------|------------------------|-----------|
| Session files over stdout | Essential | Hermes has no stdout usage; pi JSONL risks memory; all harnesses write sessions |
| `zenon.red{action:<id>}` correlation | Accidental (mechanism) | Shipped; grep-safe vs `Action #id` |
| `0`/`0` on extraction miss | Essential (failure semantics) | Run metadata still valuable; non-fatal |
| Two `u64` columns only | Essential | Matches harness sources; no cost |
| Client-side profile aggregates | Essential derived | No new STDB views; MVP simplicity |

## Resolved assumptions (MVP)

- **One dispatch, one harness process:** Probe runs one action at a time; each dispatch spawns a fresh harness CLI invocation with the full prompt including the correlation marker.
- **Hermes session model:** `hermes -z "<prompt>"` normally creates or updates one session per invocation. Row totals in `state.db` are valid when the correlated artifact contains **exactly one** action marker. If multiple markers appear in the same session artifact, parsers MUST scope via message-level data (JSON snapshots); otherwise return `0`/`0` rather than overstating usage.
- **Pi / opencode / openclaw:** JSONL or per-message stores support marker-to-marker line scoping as the primary path.

## Risks / Trade-offs

- **[Session reuse]** Long-lived sessions may include prior runs → Mitigation: marker-to-marker scoping; Hermes row totals only when single-marker
- **[Parse drift]** Harness updates JSON shape → Mitigation: unit fixtures per harness; lab Phase 4 cross-check
- **[False grep hits]** Rare substring collision → Mitigation: fixed-prefix `grep -rlF` on full marker string
- **[Cross-repo publish order]** Bindings out of sync → Mitigation: stdb publish first, then regen probe + frontend

## Open Questions

1. Profile layout: one "Tokens total" chip vs separate In/Out on narrow viewports.
2. Whether `openclaw --local` is needed for consistent session-file paths in production.
