## Codebase Exploration

### Current Onboard Announcement Flow

The `sendAnnouncement` step (step 15 of 16 in `probe/src/utils/onboard/steps.ts:452-488`) sends a message to the `general` channel:

```
channelId: general.id
content: "Hi! I'm <name>, ready to contribute."
messageType: { tag: "User" }
contextId: "onboard:<agentId>"
```

It gates on scheduler confirmation (skip if scheduler not configured), and on `--dry-run`. It does **not** gate on whether an announcement has already been sent.

### Why It Duplicates

1. `send_message` reducer (`nexus/stdb/src/reducers/messaging/send.rs`) is append-only — no uniqueness constraint on `context_id`, no dedup logic.
2. `Message` table (`nexus/stdb/src/tables/message.rs`) has no unique index on `context_id`.
3. Probe's `sendAnnouncement` has no pre-flight check for existing messages with `contextId = "onboard:<agentId>"`.
4. Re-running `probe onboard` is explicitly designed to be safe for most steps (wallet creation checks `walletExists`, registration checks for existing agent, etc.) — but the announcement step lacks this idempotency.

### Agent Table Schema

The `agents` table (`nexus/stdb/src/tables/agent.rs`) currently has:

- `id` (PK), `name`, `bio`, `role`, `capabilities`, `status`, `zenon_address`, `identity` (unique), `last_heartbeat`, `current_task_id`, `created_at`, `last_active_at`
- No `onboarded_at` field exists.

### Cross-Repo Scope

This change requires coordinated updates in two repos:

1. **nexus** (`~/workspace/zenon-red/nexus/stdb/`) — new reducer + optional agent table field
2. **probe** (`~/workspace/zenon-red/probe/`) — call new reducer instead of raw `sendMessage`

## Sources

- `probe/src/utils/onboard/steps.ts` — `sendAnnouncement()` function
- `nexus/stdb/src/reducers/messaging/send.rs` — `send_message` reducer (no dedup)
- `nexus/stdb/src/tables/message.rs` — Message table (no unique index on context_id)
- `nexus/stdb/src/tables/agent.rs` — Agent table (no onboarded_at)
- Issue #44: https://github.com/zenon-red/probe/issues/44

## Approach A: Server-side `onboarded_at` + dedicated reducer

Add `onboarded_at: Option<Timestamp>` to the Agent table and a `finalize_onboarding` reducer that atomically checks and sets it.

Probe calls `finalize_onboarding(agent_id, channel_id, content, context_id)` instead of `sendMessage`. The reducer:

1. Looks up agent by identity
2. If `onboarded_at` is already set → no-op (return Ok)
3. Else → insert announcement message + set `onboarded_at = now`

This is the approach proposed in issue #44. It models onboarding as a durable lifecycle event at the server level.

**Feasibility**: Requires nexus schema migration (new column), new reducer, and probe client update. Cross-repo coordinated deploy.

**Complexity**: Medium. Schema change + reducer + client migration. The reducer is straightforward (~30 lines of Rust), but requires deploying the nexus change before probe can use it.

**Alignment**: Strong. Fits the existing pattern of server-side state guards (similar to how `registerAgent` checks for duplicate identities). Makes the invariant (onboard once) explicit in the data model.

## Approach B: Client-side pre-flight check on context_id

Before calling `sendMessage`, Probe queries the `messages` table for any existing message with `context_id = "onboard:<agentId>"`. If found, skip.

No nexus changes required. Uses existing subscription data already loaded in `CommandContext`.

**Feasibility**: Probe-only change. Can be implemented immediately with no cross-repo coordination.

**Complexity**: Low. Single conditional check in `sendAnnouncement`.

**Alignment**: Weak. Relies on the assumption that the local subscription cache has all historical messages, which may not hold after reconnections or subscription resets. Race condition: two concurrent onboard runs could both pass the pre-flight check before either inserts. The invariant is not enforced server-side.

## Approach C: Server-side dedup in `send_message` by context_id

Add uniqueness enforcement to the existing `send_message` reducer: if a message with the same `context_id` already exists, skip insert.

**Feasibility**: Nexus-only change. Requires adding a unique index on `context_id` (or a partial index) and modifying the `send_message` reducer.

**Complexity**: Low to medium. Simple reducer change, but `context_id` is `Option<String>` — making it unique requires handling NULLs (which are typically excluded from unique indexes in most databases). A partial index on non-null context_ids would work but is SpacetimeDB-specific in implementation.

**Alignment**: Moderate. Generic dedup mechanism that applies to all messages, not just onboarding. This could be useful broadly but also introduces a constraint that may not be desired for all message flows (e.g., status updates might intentionally reuse context_ids). Overloads a generic mechanism for a specific lifecycle need.

## Recommended Approach

**Approach A** (server-side `onboarded_at` + dedicated reducer).

Onboarding is a lifecycle event, not a messaging concern. Modeling it as a first-class field on the Agent record makes the invariant explicit, queryable, and atomic. It avoids the race conditions of client-side checks and avoids overloading `context_id` dedup for lifecycle semantics.

The cross-repo coordination cost is real but manageable: nexus change deploys first, probe falls back gracefully if the reducer doesn't exist yet.

## Trade-offs

**Approach A gives up**: Immediate deployability. Requires nexus schema migration and coordinated release. Also adds a field to the Agent table that is only relevant during onboarding.

**Approach B gives up**: Correctness guarantees. Race conditions under concurrent onboards. Depends on local subscription state being complete (not guaranteed after reconnects). Fast to ship but fragile.

**Approach C gives up**: Semantic clarity. Using `context_id` dedup conflates "onboarding happened" with "a message was sent," and the generic dedup could interfere with other message flows that intentionally reuse context_ids. May also require SpacetimeDB-specific index handling for nullable columns.

**Edge cases**:

- A: Concurrent onboarding → reducer handles atomically, second call is a no-op
- B: Concurrent onboarding → both pass pre-flight, both insert → duplicate
- C: Concurrent onboarding → depends on SpacetimeDB unique constraint timing; second reducer call fails or no-ops

**Future flexibility**:

- A: `onboarded_at` is queryable for admin dashboards, agent filtering, etc. The field has standalone value beyond dedup.
- B: No new capabilities. Only prevents duplicates in the happy path.
- C: Generic dedup could be useful for other flows, but also constrains them.
