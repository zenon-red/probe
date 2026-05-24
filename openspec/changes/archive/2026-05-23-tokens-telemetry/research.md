## Codebase Exploration

### Shipped (Central Dispatch)

**STDB `agent_actions`** (`nexus/stdb/src/tables/agent_action.rs`) already stores run metadata: `run_started_at`, `run_finished_at`, `run_outcome`, `run_duration_secs`, `harness`. No token columns yet.

**Reducers** (`nexus/stdb/src/reducers/dispatch/report.rs`):
- `report_action_run_started(action_id, harness)` — sets `run_started_at`, `harness`
- `report_action_run_finished(action_id, outcome, duration_secs)` — sets finish fields; **no token args**

**Probe daemon** (`probe/src/daemon/action-executor.ts`):
- Builds prompt via `buildActionPrompt` (line 1 = `zenon.red{action:<id>}` from `action-prompts.ts` — **shipped**)
- Calls both reducers around `runHarness`; passes only `outcome` + `durationSecs` on finish
- Harness spawn unchanged in `harness-runner.ts` (`pi -p`, `hermes -z`, `opencode run`, `openclaw agent -m --json`); stdout is piped but not parsed for usage

**Frontend** (`nexus/frontend/src/routes/AgentProfilePage.tsx`):
- Shows contribution stats (Tasks, Ideas, Votes, Messages, Discoveries) via `InlineStat`
- Generated bindings include `run_started_at` etc. on `agent_actions`; no token fields; no Operations block

**Spec** (`probe/openspec/specs/probe.md`): documents run metadata reporting; no token extraction requirements yet.

### Harness session persistence (from PRD + prior investigation)

| Harness | Data root | Usage fields |
|---------|-----------|--------------|
| pi | `~/.pi/agent/sessions/*.jsonl` | `message.usage.input` / `.output` on assistant messages |
| hermes | `~/.hermes/state.db` | `sessions.input_tokens`, `sessions.output_tokens` |
| opencode | `~/.local/share/opencode/storage/session/message/` | `tokens.input`, `tokens.output` on `step-finish` messages |
| openclaw | `~/.openclaw/sessions/` | `usage.input`, `usage.output` in transcript/metadata |

Hermes `-z` emits final text only on stdout — session DB is authoritative. Pi `--mode json` would stream full JSONL to stdout (memory risk); session files avoid that.

### State classification

| Data | Class | Rationale |
|------|-------|-----------|
| `input_tokens`, `output_tokens` on `agent_actions` | **Essential derived** | User wants durable per-run token totals; derived from harness session artifacts + correlation marker |
| `zenon.red{action:<id>}` in prompt | **Accidental (correlation)** | Not stored in STDB; enables grep-based session lookup |
| Full session transcripts | **Accidental** | Harness-local; lab audit only |
| Profile Operations aggregates | **Essential derived** | Client-side sums over `agent_actions` rows |
| Cache/cost columns | **Out of scope** | User explicitly excluded |

## Sources

- `docs/todo/prd-agent-telemetry.md` — agreed scope (input/output tokens, session-store extraction, frontend Operations)
- `probe/src/utils/action-prompts.ts`, `probe/src/daemon/action-executor.ts`, `probe/src/daemon/harness-runner.ts`
- `nexus/stdb/src/tables/agent_action.rs`, `nexus/stdb/src/reducers/dispatch/report.rs`
- `nexus/frontend/src/routes/AgentProfilePage.tsx`
- Related: `nexus/docs/todo/prd-dev-lab.md` (same correlation + extractor for lab audit)

## Approach A: Post-run session store reads

After harness exit, grep harness data root for `zenon.red{action:<id>}`, pick newest mtime after `run_started_at` if multiple hits, parse usage from that session only, sum input/output, pass to `report_action_run_finished`. On miss → `0`/`0` (non-fatal).

Aligns with dev lab audit strategy; O(1) memory (accumulate counts while parsing); no stdout buffering.

## Approach B: Stdout JSONL parsing

Enable structured stdout modes (`pi --mode json`, etc.) and parse usage events from the pipe during `runHarness`. Hermes still lacks stdout usage — would need a hybrid (stdout + DB). Pi JSONL is high volume and risks memory pressure if buffered.

## Approach C: Harness-native usage callbacks / env vars

Require each harness to print a single trailing JSON line with totals, or accept `PROBE_ACTION_ID` and write usage to a known file. Needs upstream harness changes; breaks “spawn args unchanged” constraint.

## Recommended Approach

**Approach A** — post-run session store reads with `zenon.red{action:<id>}` correlation. Already shipped in probe prompts; all four harnesses persist usage in session artifacts; matches dev lab; avoids stdout/memory issues.

## Trade-offs

| | Session files (A) | Stdout JSONL (B) | Harness changes (C) |
|--|-------------------|------------------|---------------------|
| **Gives up** | Depends on disk layout per harness version | Simple for pi/opencode only | Zero file I/O |
| **Failure modes** | Missed grep, reused long-lived sessions, parse drift | Hermes gap; pi memory; pipe backpressure | Harness version skew |
| **Future** | Shared module with dev lab; optional `harnessDataRoots` config | Hard to unify four harnesses | Clean if harnesses adopt standard |

**Edge cases:** Session reuse across actions → scope parsing from marker line to next marker or EOF. Pre-upgrade rows → tokens `0` but still count as runs in UI.
