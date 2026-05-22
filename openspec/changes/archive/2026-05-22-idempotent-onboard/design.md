## Context

Probe's `probe onboard` command runs a 16-step pipeline. Step 15 (`sendAnnouncement`) sends a greeting to the `general` channel via the `sendMessage` reducer. The `sendMessage` reducer is append-only with no dedup. Re-running onboard duplicates the message.

Most onboard steps are already idempotent (wallet checks `walletExists`, registration checks for existing agent). The announcement step is the gap.

Two repos involved: `nexus/stdb` (SpacetimeDB backend in Rust) and `probe` (CLI in TypeScript). Nexus must deploy first; probe falls back to legacy path during transition.

## Goals / Non-Goals

**Goals:**

- Make the onboarding announcement happen exactly once per agent, enforced server-side
- Make `probe onboard` fully safe to re-run (all steps idempotent)
- Gate on `onboarded_at`, not on scheduler state (scheduler may be removed in future — see Central Dispatch PRD)

**Non-Goals:**

- Backfilling `onboarded_at` for historical agents (they keep `None`)
- Changing the `sendMessage` reducer itself (no generic dedup)
- Changing the onboarding message content or format
- Adding onboarding lifecycle states beyond binary (onboarded / not onboarded)

## Cross-repo Scope

- **nexus/stdb**: Add `onboarded_at: Option<Timestamp>` field to `Agent` table in `nexus/stdb/src/tables/agent.rs`; implement `finalize_onboarding` reducer in `nexus/stdb/src/reducers/agent/finalize.rs` — resolves caller by identity, no-op if already onboarded, else inserts message + sets timestamp atomically
- **nexus/stdb**: Register `pub mod finalize;` in `nexus/stdb/src/reducers/agent/mod.rs`

## Decisions

**D1: Reducer lookup key is identity, not agent_id** (essential)

The reducer uses `ctx.sender()` → `agents.identity.find()` to identify the caller. This matches every other agent-scoped reducer in the codebase (heartbeat, set_status, update_bio, etc.). Agent_id is a user-chosen string; identity is the cryptographic SpacetimeDB auth. Identity is the canonical key.

**D2: Single transaction — message insert + field update** (essential)

The reducer inserts a message row and updates the agent row in one SpacetimeDB transaction. If either fails, the entire reducer call fails. No partial state possible.

**D3: No explicit return status — caller infers from state** (essential)

The reducer returns `Result<(), String>`. Success means either "onboarding completed" or "already onboarded" — both are `Ok(())`. The caller distinguishes by checking `onboarded_at` on the agent row after the reducer completes. This avoids adding a return type to the reducer signature while keeping behavior observable.

**D4: No fallback — reducer must exist** (essential)

Probe calls `finalize_onboarding` directly. If the reducer doesn't exist, `callReducer` throws and the step fails — same as every other reducer call in probe. Nexus must be deployed with the new reducer before probe can use it. No legacy `sendMessage` code path.

**D5: No migration/backfill** (essential)

Existing agents with `onboarded_at = None` are a valid state. The field being `None` means "onboarding status unknown" — not "not onboarded." Running `probe onboard` for an existing agent sets it. Agents created before this change keep `None` forever unless re-onboarded.

## Essential State

### Modified Relation: `agents`

Add one attribute:

| Attribute      | Type                | Default | Constraint                                                       |
| -------------- | ------------------- | ------- | ---------------------------------------------------------------- |
| `onboarded_at` | `Option<Timestamp>` | `None`  | At most one non-None value per agent (trivially satisfied by PK) |

Invariant: if `onboarded_at` is `Some(t)`, then there exists exactly one `Message` row with `context_id = "onboard:<agent.id>"` and `sender_id = agent.id`. (Enforced by reducer, not by schema constraint — messages are append-only and the reducer is the sole writer.)

No new relations. No new tables.

## Essential Logic

### Derived: `is_onboarded(agent) → bool`

```
agent.onboarded_at IS NOT None
```

### Derived: `onboarding_event_message(agent) → Option<Message>`

The announcement message for an onboarded agent. Used by observers to display onboarding history.

```
messages WHERE context_id = "onboard:" + agent.id
         AND sender_id = agent.id
```

Returns `None` if agent not yet onboarded. Returns exactly one message if onboarded (guaranteed by reducer).

## Accidental State & Control

- **Subscription autocompatibility**: The `agents` table is already subscribed by all probe commands that use `CommandContext`. The new `onboarded_at` field appears in the subscription payload automatically — no subscription query changes needed.
- **Module bindings regeneration**: After nexus deploys, probe must regenerate `src/module_bindings/` from the new schema. This is a build step, not a runtime concern.

## Feeders / Observers

### Feeder: `finalize_onboarding` reducer (nexus)

Input:

```
content: String       — announcement text ("Hi! I'm <name>, ready to contribute.")
context_id: String    — "onboard:<agent_id>"
```

The reducer:

1. Resolve caller identity → agent
2. If `agent.onboarded_at IS NOT None` → return `Ok(())` (no-op)
3. Find the `general` channel
4. Insert `Message` with `content`, `context_id`, `message_type = User`
5. Update `agent.onboarded_at = ctx.timestamp`
6. Return `Ok(())`

Steps 4-5 are a single SpacetimeDB transaction.

### Feeder: `sendAnnouncement` step (probe)

Input: `OnboardState` (wallet, agentId, name, token, host, module)

The step:

1. Connect with auth (`withAuth`)
2. Call `finalize_onboarding` reducer via `callReducer(ctx, "finalizeOnboarding", { content, contextId })`
3. Record step result (pass on success, warn on failure)

### Observer: Onboard step summary (probe)

After the reducer completes, the `finish()` function in `onboard.ts` reports step status. No changes needed — the step result (`pass`/`warn`/`skip`) feeds into the existing summary logic.

## Risks / Trade-offs

| Risk                                            | Mitigation                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Concurrent onboarding calls race                | Reducer is atomic — second call sees `onboarded_at` already set, becomes no-op                     |
| Probe runs without nexus reducer                | `callReducer` throws, step fails with `warn`. Operator deploys nexus first.                        |
| `onboarded_at = None` for historical agents     | Valid state. Field reads as "unknown." No functional impact — only affects observability.          |
| Step rename `announcement` → `onboarding_event` | Non-breaking: step labels are internal to the onboard summary output, not part of any API contract |

## Open Questions

- Should the reducer accept `channel_name` instead of hardcoding `general`? Current proposal hardcodes general. If onboarding ever targets a different channel, the reducer signature needs updating. Given no current need, hardcoding is simpler.
