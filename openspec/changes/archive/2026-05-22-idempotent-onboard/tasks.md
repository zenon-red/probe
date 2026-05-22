## 0. Cross-repo Prerequisites

- [x] 0.1 Create openspec change in **nexus** for `finalize_onboarding` reducer and `onboarded_at` field on Agent table

## 1. Essential State

_No essential state changes in this repo._

## 2. Essential Logic

_No essential logic changes in this repo._

## 3. Accidental State and Control

- [x] 3.1 Regenerate probe `src/module_bindings/` after nexus schema change (run `nexus/stdb/scripts/generate.sh`)

## 4. Feeders and Observers

- [x] 4.1 Rewrite `sendAnnouncement` in `probe/src/utils/onboard/steps.ts` — replace `sendMessage` call with `callReducer(ctx, "finalizeOnboarding", { content, contextId })`
- [x] 4.2 Rename step label from `announcement` to `onboarding_event` in the rewritten `sendAnnouncement` function
- [x] 4.3 Remove scheduler gate from `sendAnnouncement` — the step should gate on `onboarded_at` (server-side), not on scheduler status
