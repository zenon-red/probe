## ADDED Requirements

### Requirement: Agent has an onboarded_at timestamp

The `agents` relation SHALL include an `onboarded_at` attribute of type `Option<Timestamp>`. The value SHALL be `None` for agents that have not completed onboarding finalization, and `Some(timestamp)` for agents that have.

#### Scenario: Newly registered agent

- **WHEN** an agent is registered via `registerAgent`
- **THEN** `onboarded_at` SHALL be `None`

#### Scenario: Agent that completed onboarding before this change

- **WHEN** an agent was onboarded before `onboarded_at` was introduced
- **THEN** `onboarded_at` SHALL be `None`
- **AND** this is a valid state meaning "onboarding status unknown"

### Requirement: finalize_onboarding reducer is atomic and idempotent

A `finalize_onboarding` reducer SHALL exist that accepts `content: String` and `context_id: String`. The reducer SHALL resolve the caller by SpacetimeDB identity. If `onboarded_at` is already `Some`, the reducer SHALL return `Ok(())` without side effects. Otherwise, the reducer SHALL insert one `Message` row into the `general` channel and set `onboarded_at` to the current timestamp, in a single transaction.

#### Scenario: First onboarding call

- **GIVEN** agent with `onboarded_at = None`
- **WHEN** `finalize_onboarding` is called with `content = "Hi! I'm Zoe, ready to contribute."` and `context_id = "onboard:zoe-1"`
- **THEN** a `Message` row SHALL exist with `channel_id = general`, `content = "Hi! I'm Zoe, ready to contribute."`, `context_id = "onboard:zoe-1"`, `message_type = User`
- **AND** `onboarded_at` SHALL be `Some(timestamp)` where timestamp matches the reducer invocation time

#### Scenario: Duplicate onboarding call

- **GIVEN** agent with `onboarded_at = Some(t)` (already onboarded)
- **WHEN** `finalize_onboarding` is called with any content
- **THEN** no new `Message` row SHALL be inserted
- **AND** `onboarded_at` SHALL remain `Some(t)` unchanged

#### Scenario: Concurrent onboarding calls

- **GIVEN** agent with `onboarded_at = None`
- **WHEN** two concurrent calls to `finalize_onboarding` occur
- **THEN** exactly one `Message` row SHALL be inserted (SpacetimeDB reducer serializes within a transaction)
- **AND** `onboarded_at` SHALL be `Some(timestamp)` from the first committed call

### Requirement: Caller identity gates reducer access

The reducer SHALL resolve the agent by `ctx.sender()` → `agents.identity.find()`. If no agent matches the caller identity, the reducer SHALL return `Err("Agent not registered")`.

#### Scenario: Unregistered identity

- **GIVEN** no agent with `identity = ctx.sender()`
- **WHEN** `finalize_onboarding` is called
- **THEN** the reducer SHALL return `Err("Agent not registered")`

#### Scenario: Registered identity

- **GIVEN** agent with `identity = ctx.sender()` and `onboarded_at = None`
- **WHEN** `finalize_onboarding` is called
- **THEN** the reducer SHALL proceed with onboarding finalization

### Requirement: Probe sends onboarding event via finalize_onboarding

The `sendAnnouncement` step in `probe onboard` SHALL call `finalize_onboarding` instead of `sendMessage`. The step SHALL pass `content = "Hi! I'm {name}, ready to contribute."` and `context_id = "onboard:{agentId}"`. If the reducer call fails, the step SHALL record status `warn`.

#### Scenario: Successful onboarding finalization

- **GIVEN** probe onboard reaches the announcement step
- **AND** agent is registered with a valid cached token
- **WHEN** `sendAnnouncement` executes
- **THEN** probe SHALL call `callReducer(ctx, "finalizeOnboarding", { content, contextId })`
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
