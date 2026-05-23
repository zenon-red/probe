## ADDED Requirements

### Requirement: probe action show

The `probe action show <id>` command SHALL display the executable intent of an action row.

Output SHALL include: id, kind, route, skill, instruction, target_type, target_id, reason_code, trigger_type, trigger_id, status, and context commands relevant to the action kind.

The command SHALL require authentication.

#### Scenario: Show existing action

- **GIVEN** action #42 exists with `status = Issued`, `kind = Vote`, `skill = "zr-vote"`, `target_type = "idea"`, `target_id = "7"`
- **WHEN** `probe action show 42` runs
- **THEN** output SHALL include the skill, kind, target, and instruction fields
- **AND** context commands SHALL include `probe idea get 7` and `probe idea dimensions`

#### Scenario: Action not found

- **GIVEN** no action with id 999 exists
- **WHEN** `probe action show 999` runs
- **THEN** the command SHALL exit with error

### Requirement: probe action complete

The `probe action complete <id>` command SHALL mark an action as completed by calling `update_agent_action` with `event_type = Completed`.

The command SHALL require authentication.
The caller SHALL own the action (caller identity matches action's agent identity).
The command SHALL NOT be used for actions with `route = ReviewTask` or `route = ValidateReview`; those routes SHALL use `probe action review` or `probe action validate-review` respectively.

#### Scenario: Complete owned action

- **GIVEN** action #42 is `Issued`, owned by the caller's agent, and `route` is not `ReviewTask` or `ValidateReview`
- **WHEN** `probe action complete 42` runs
- **THEN** the `update_agent_action` reducer SHALL be called with `action_id = 42`, `event_type = Completed`

#### Scenario: Complete another agent's action

- **GIVEN** action #42 is `Issued` and owned by a different agent
- **WHEN** `probe action complete 42` runs
- **THEN** the command SHALL exit with error

#### Scenario: Complete rejected for ReviewTask route

- **GIVEN** action #42 is `Issued`, owned by the caller's agent, and `route = ReviewTask`
- **WHEN** `probe action complete 42` runs
- **THEN** the command SHALL exit with error before calling any reducer
- **AND** the error SHALL indicate `probe action review` as the correct command

### Requirement: probe action fail

The `probe action fail <id> --reason "..."` command SHALL mark an action as failed by calling `update_agent_action` with `event_type = Failed` and `note = reason`.

The command SHALL require authentication.
The caller SHALL own the action.

#### Scenario: Fail with reason

- **GIVEN** action #42 is `Issued` and owned by the caller's agent
- **WHEN** `probe action fail 42 --reason "Build failed"` runs
- **THEN** the `update_agent_action` reducer SHALL be called with `event_type = Failed`, `note = "Build failed"`

### Requirement: probe action skip

The `probe action skip <id> --reason "..."` command SHALL mark an action as skipped by calling `update_agent_action` with `event_type = Skipped` and `note = reason`.

The command SHALL require authentication.
The caller SHALL own the action.

#### Scenario: Skip with reason

- **GIVEN** action #42 is `Issued` and owned by the caller's agent
- **WHEN** `probe action skip 42 --reason "Already claimed by another agent"` runs
- **THEN** the `update_agent_action` reducer SHALL be called with `event_type = Skipped`, `note = "Already claimed by another agent"`

### Requirement: probe action review

The `probe action review <id> --outcome <approved|changes-requested> --summary "..."` command SHALL complete a `ReviewTask` action and record a `TaskReview` row.

The command SHALL require authentication. The caller SHALL own the action. The action `route` SHALL be `ReviewTask`.

#### Scenario: Complete review with approval

- **GIVEN** action #42 is `Issued`, owned by the caller's agent, and has route `ReviewTask`
- **WHEN** `probe action review 42 --outcome approved --summary "Looks good"` runs
- **THEN** the review completion reducer SHALL be called with `outcome = Approved` and `summary = "Looks good"`

#### Scenario: Complete review with requested changes

- **GIVEN** action #42 is `Issued`, owned by the caller's agent, and has route `ReviewTask`
- **WHEN** `probe action review 42 --outcome changes-requested --summary "Needs error handling"` runs
- **THEN** the review completion reducer SHALL be called with `outcome = ChangesRequested` and the provided summary

### Requirement: probe action validate-review

The `probe action validate-review <id> --outcome <valid|invalid> --summary "..."` command SHALL complete a `ValidateReview` action and record a `TaskReviewValidation` row.

The command SHALL require authentication. The caller SHALL own the action. The action `route` SHALL be `ValidateReview`.

#### Scenario: Validate review as valid

- **GIVEN** action #43 is `Issued`, owned by the caller's agent, and has route `ValidateReview`
- **WHEN** `probe action validate-review 43 --outcome valid --summary "Review is accurate"` runs
- **THEN** the validation completion reducer SHALL be called with `outcome = Valid` and the provided summary

#### Scenario: Validate review as invalid

- **GIVEN** action #43 is `Issued`, owned by the caller's agent, and has route `ValidateReview`
- **WHEN** `probe action validate-review 43 --outcome invalid --summary "Reviewer missed the main issue"` runs
- **THEN** the validation completion reducer SHALL be called with `outcome = Invalid` and the provided summary
