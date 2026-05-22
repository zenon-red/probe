## Why

Re-running `probe onboard` duplicates the general channel announcement because `send_message` is append-only with no dedup and no server-side guard. Onboarding is designed to be rerunnable (most steps are idempotent), but the announcement step is not. This needs to be a durable, atomic lifecycle event.

## What Changes

- **nexus**: Add `onboarded_at: Option<Timestamp>` field to the `agents` table
- **nexus**: Add `finalize_onboarding` reducer that atomically gates on `onboarded_at`, inserts the announcement message, and sets the timestamp — all in one reducer call
- **nexus**: No migration/backfill — existing agents with announcements keep `onboarded_at = None`; the field is populated on next `probe onboard` call or remains null for historical agents
- **probe**: Replace `sendMessage` call in `sendAnnouncement` with `finalize_onboarding` reducer call
- **probe**: Rename step label from `announcement` to `onboarding_event` to reflect lifecycle semantics

## Capabilities

### New Capabilities

- `onboarding-finalization`: Server-side atomic guard ensuring onboarding announcement happens exactly once per agent. Covers the `onboarded_at` field, the `finalize_onboarding` reducer contract, and the probe client migration.

### Modified Capabilities

_(none — no existing specs to modify)_

## Impact

- **nexus/stdb**: Schema change to `agents` table (new `onboarded_at` column). New reducer under `nexus/stdb/src/reducers/agent/`. Module bindings regeneration required.
- **probe**: Changes to `src/utils/onboard/steps.ts` (`sendAnnouncement`). New reducer binding consumed via `callReducer`. Module bindings update needed after nexus deploy.
- **Deployment order**: nexus must deploy first. Probe calls the reducer directly — if it doesn't exist, the step fails (same as any other reducer call).
- **SpacetimeDB subscription**: The `agents` table is already subscribed — the new field appears automatically in existing clients without subscription changes.
