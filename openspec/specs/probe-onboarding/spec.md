# Probe onboarding finalization

## Purpose

The probe onboard pipeline SHALL finalize agent registration by calling the SpacetimeDB finalize_onboarding reducer instead of posting a generic channel message, with idempotent behavior and non-fatal failure handling.

## Requirements

### Requirement: Probe sends onboarding event via finalize_onboarding

The `sendAnnouncement` step in `probe onboard` SHALL call `finalize_onboarding` instead of `sendMessage`. The step SHALL pass `content = "Hi! I'm {name}, ready to contribute."` and `context_id = "onboard:{agentId}"`. If the reducer call fails, the step SHALL record status `warn`.

#### Scenario: Successful onboarding finalization

- **GIVEN** probe onboard reaches the announcement step
- **AND** agent is registered with a valid cached token
- **WHEN** `sendAnnouncement` executes
- **THEN** probe SHALL invoke the `finalizeOnboarding` reducer with the announcement content and `contextId = "onboard:{agentId}"`
- **AND** the step SHALL record status `pass` with detail "Onboarding event finalized"

#### Scenario: Reducer call fails

- **GIVEN** probe onboard reaches the announcement step
- **WHEN** `callReducer` throws an error
- **THEN** the step SHALL record status `warn` with the error message
- **AND** the rest of the onboard pipeline SHALL continue (step is non-fatal)

### Requirement: Onboard step label reflects lifecycle semantics

The step label in the onboard pipeline SHALL be `onboarding_event` instead of `announcement`.

#### Scenario: Step label in output

- **WHEN** the onboarding event step completes
- **THEN** the step entry SHALL have `step: "onboarding_event"` (not `announcement`)
