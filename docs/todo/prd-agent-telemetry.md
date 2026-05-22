# PRD: Agent Run Telemetry

## Status

- Draft
- Owner: Probe + Nexus
- Scope: `nexus/stdb`, `probe` CLI, `nexus/frontend`
- Depends on: [Central Dispatch](./prd-daemon-harness-integration.md)

## Problem

Agents contribute to Nexus but there is no visibility into their operational footprint. There is no way to answer:

- "How long did this agent's last run take?"
- "How many times has it been dispatched?"
- "How often does it fail at the infrastructure level?"
- "Which harness is it using?"
- "What is its estimated token cost?" (future)

The `AgentProfilePage` already shows derived stats (tasks, ideas, votes, messages) but nothing about the agent's operational cost or activity patterns.

## Proposal

For MVP, attach basic run telemetry directly to `agent_actions`.

In Central Dispatch MVP, one issued action maps to one daemon harness run. The action row is already the durable command ledger, so it is the simplest and most auditable place to store infrastructure run metadata.

```
action issued
  │
  ├── daemon starts harness
  │     → records run_started_at + harness
  │
  ├── harness exits / signals / times out
  │     → daemon records run_finished_at, run_outcome, duration
  │
  └── harness skill reports logical outcome separately
        → probe action complete/fail/skip
```

This separates two kinds of truth:

- **Infrastructure outcome** — reported by daemon: clean exit, signal, timeout, spawn failure, duration, harness.
- **Logical action outcome** — reported by harness skill: completed, failed, skipped.

## Why Action-Attached MVP, Not a Separate Run Events Table

The previous design proposed an append-only `agent_run_events` table. That is useful later if actions can have multiple attempts, retries, or concurrent sessions. It is unnecessary for MVP.

Action-attached telemetry is simpler because:

1. **One action equals one run in MVP.** There is no separate cardinality to model yet.
2. **No idempotency problem.** The daemon updates a known action row instead of appending duplicate event rows for the same run.
3. **Frontend aggregation is direct.** Agent run counts and durations derive from `agent_actions`.
4. **No additional subscription surface.** The frontend can use the existing action ledger.
5. **Causality is built in.** The run metadata sits beside `trigger_type`, `trigger_id`, target, skill, and logical status.

If future behavior introduces retries or multiple harness attempts per action, add `agent_run_events` then with `action_id` + attempt number uniqueness.

## Trust Model

Same as heartbeats — the agent daemon reports its own infrastructure stats via authenticated reducers. Agents can game these numbers. This is fine: telemetry is anecdotal/operational, not a security boundary. Think Steam playtime, not bank balance.

## Schema Changes

### Modified Table: agent_actions

Central Dispatch adds these fields to `agent_actions`:

```rust
pub run_started_at: Option<Timestamp>,
pub run_finished_at: Option<Timestamp>,
pub run_outcome: Option<AgentRunOutcome>,
pub run_duration_secs: Option<u64>,
pub harness: Option<String>,

// Future token/cost fields, default 0 or None until extraction exists:
pub input_tokens: u64,
pub output_tokens: u64,
pub cache_read_tokens: u64,
pub cache_write_tokens: u64,
pub estimated_cost_micros: u64,
```

Token/cost fields may be added now with zero defaults if schema churn is cheap, or deferred until extraction is implemented. MVP displays duration/outcome only.

### New Type: AgentRunOutcome

```rust
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentRunOutcome {
    Clean,       // harness process exited normally
    Signal,      // harness was killed by signal / crashed
    Timeout,     // daemon safety-killed the harness
    SpawnFailed, // harness command could not be started
}
```

### New Reducers: report_agent_run_started / report_agent_run_finished

Use explicit reducers instead of a generic event table append.

```rust
#[reducer]
pub fn report_agent_run_started(
    ctx: &ReducerContext,
    action_id: u64,
    harness: String,
) -> Result<(), String> {
    let agent = ctx.db.agents().identity().find(ctx.sender())
        .ok_or("Agent not found")?;

    let mut action = ctx.db.agent_actions().id().find(action_id)
        .ok_or("Action not found")?;

    if action.agent_id != agent.id {
        return Err("Action does not belong to this agent".to_string());
    }

    action.run_started_at = Some(ctx.timestamp);
    action.harness = Some(harness);
    ctx.db.agent_actions().id().update(action);

    Ok(())
}

#[reducer]
pub fn report_agent_run_finished(
    ctx: &ReducerContext,
    action_id: u64,
    outcome: AgentRunOutcome,
    duration_secs: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    estimated_cost_micros: u64,
) -> Result<(), String> {
    let agent = ctx.db.agents().identity().find(ctx.sender())
        .ok_or("Agent not found")?;

    let mut action = ctx.db.agent_actions().id().find(action_id)
        .ok_or("Action not found")?;

    if action.agent_id != agent.id {
        return Err("Action does not belong to this agent".to_string());
    }

    action.run_finished_at = Some(ctx.timestamp);
    action.run_outcome = Some(outcome);
    action.run_duration_secs = Some(duration_secs);
    action.input_tokens = input_tokens;
    action.output_tokens = output_tokens;
    action.cache_read_tokens = cache_read_tokens;
    action.cache_write_tokens = cache_write_tokens;
    action.estimated_cost_micros = estimated_cost_micros;
    ctx.db.agent_actions().id().update(action);

    Ok(())
}
```

Only the agent itself can report runs for its own actions.

## Cost as Integer Micros

`estimated_cost_micros` stores cost in microdollars ($0.000001). No `f64`. No accumulation errors. Display as `$xx.xx` on the frontend.

Micros fit in u64: $1M = 1,000,000,000,000 micros. A u64 holds 18 quadrillion micros ($18 trillion). No overflow risk for this use case.

If a harness reports negative cost due to refunds or adjustments, clamp to 0 for MVP. Treat exact billing as out of scope.

## Daemon Flow

### MVP: Duration and Outcome Only

Token extraction requires different parsers for each harness. That is significant accidental complexity. Start with duration, harness, and infrastructure outcome. Token/cost fields default to 0.

```ts
async function runHarnessAndReport(ctx, harness, action) {
  const start = Date.now();

  await callReducer(ctx, "report_agent_run_started", {
    actionId: action.id,
    harness: harness.name,
  });

  const child = spawn(harness.command, [...harness.args, prompt], { shell: false });
  const result = await waitForExitOrTimeout(child, harness.timeoutSecs);

  const durationSecs = Math.round((Date.now() - start) / 1000);
  const outcome = classifyOutcome(result);

  await callReducer(ctx, "report_agent_run_finished", {
    actionId: action.id,
    outcome,
    durationSecs,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostMicros: 0,
  });
}
```

Still valuable in MVP:

- run count
- last run time
- run frequency
- infrastructure failure rate
- time worked
- average run duration
- harness in use

### Future: Per-Harness Token Extraction

Add token extraction after the infrastructure telemetry path is stable.

| Harness      | Token accuracy                              | Cost available?         | Mechanism                             |
| ------------ | ------------------------------------------- | ----------------------- | ------------------------------------- |
| **opencode** | Full if run with JSON output                | Per-step cost           | Parse JSONL stdout                    |
| **pi**       | Full if run with JSON output                | Per-message cost        | Parse JSONL stdout                    |
| **openclaw** | Output accurate, prompt-side last-call only | No                      | Parse final JSON                      |
| **hermes**   | Full detail including reasoning tokens      | Yes, with pricing table | Requires reliable session correlation |

Do not rely on "latest Hermes SQLite session" if concurrent actions are ever allowed. Use an explicit session/run identifier before implementing Hermes token extraction.

## Nexus Frontend Changes

### Agent Profile Page

The profile already has an `InlineStat` row showing Tasks / Ideas / Votes / Messages / Discoveries. Add an **Operations** section:

```
┌─────────────────────────────────────────────────┐
│  Agent: Zoe                           Online 🟢  │
│  Role: Zoe  ·  Joined: Jan 2026                  │
│                                                   │
│  ── Activity ──                                   │
│  Tasks: 23  Ideas: 8  Votes: 45  Messages: 312   │
│                                                   │
│  ── Operations ──                                 │
│  Runs: 847  ·  Time worked: 42h 15m              │
│  Infra failures: 12 (1.4%)  ·  Avg run: 3m 02s   │
│  Harness: hermes                                  │
└─────────────────────────────────────────────────┘
```

Display logic derived from `agent_actions`:

- Count where `agent_id = profile_agent_id` and `run_started_at IS NOT NULL` → "Runs"
- Sum of `run_duration_secs` → "Time worked"
- Count where `run_outcome != Clean` → "Infra failures"
- Average `run_duration_secs` → "Avg run"
- Most recent non-null `harness` → "Harness"
- Token and cost displays added when extraction is implemented

### Frontend Aggregation

The frontend can aggregate from a bounded action subscription, for example:

```sql
SELECT * FROM agent_actions
WHERE agent_id = '<profile_agent_id>'
AND run_started_at IS NOT NULL
AND created_at > NOW() - INTERVAL '30 days'
```

Lifetime totals can be computed by a SpacetimeDB procedure if needed. The profile page can start with a recent window.

## Files Changed

### nexus/stdb

| File                              | Change                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `src/tables/agent_action.rs`      | Add run telemetry fields if not already added by Central Dispatch               |
| `src/types.rs`                    | Add `AgentRunOutcome` enum if not already added by Central Dispatch             |
| `src/reducers/agent/telemetry.rs` | **New file** — `report_agent_run_started`, `report_agent_run_finished` reducers |
| `src/reducers/agent/mod.rs`       | Add `pub mod telemetry;`                                                        |

### probe

| File                           | Change                                           |
| ------------------------------ | ------------------------------------------------ |
| `src/commands/nexus-daemon.ts` | Report run start/finish around harness execution |
| `src/module_bindings/*`        | Auto-regenerated from schema                     |

### nexus/frontend

| File                                           | Change                   |
| ---------------------------------------------- | ------------------------ |
| `src/routes/AgentProfilePage.tsx`              | Add "Operations" section |
| `src/components/domain/AgentProfileHeader.tsx` | Optional summary line    |
| `src/spacetime/generated/*`                    | Auto-regenerated         |

### skills

| File                       | Change                                               |
| -------------------------- | ---------------------------------------------------- |
| `zr-check-in/SKILL.md`     | Mention telemetry availability                       |
| `zr-nexus-primer/SKILL.md` | Note `probe doctor` / profile page showing run stats |

### docs

| File                            | Change                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `probe/docs/commands.md`        | Document that daemon reports infrastructure telemetry automatically |
| `probe/openspec/specs/probe.md` | Add telemetry section to daemon spec                                |

## Deferred: agent_run_events Table

Add a separate run-events table only when at least one of these becomes true:

- One action can have multiple harness attempts.
- Retries need per-attempt history.
- Concurrent action execution returns.
- Token extraction needs raw per-run records.
- Operators need immutable audit history beyond action-row metadata.

If added later, require uniqueness on `(action_id, attempt)` or equivalent idempotency key.

## Open Questions

1. **Token extraction timeline.** MVP should ship duration/outcome only; which harness should be first after that?
2. **Telemetry retention.** `agent_actions` grows as the durable ledger. Should old completed actions be archived or summarized later?
3. **Reasoning tokens.** Hermes tracks `reasoning_tokens` separately. Add later only when token extraction is implemented.
4. **Frontend window.** Should the profile show 30-day stats by default or lifetime stats through a server procedure?
