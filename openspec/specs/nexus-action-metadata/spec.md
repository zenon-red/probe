# Nexus agent action run metadata

## Purpose

The agent_actions table SHALL record harness run infrastructure metadata and token totals, and agents SHALL configure dispatch cadence via set_dispatch_cooldown.

## Requirements

### Requirement: Agent action run metadata fields

The `AgentAction` table SHALL include these fields for run metadata:

| Field | Type | Purpose |
|---|---|---|
| `run_started_at` | `Option<Timestamp>` | When the harness was spawned |
| `run_finished_at` | `Option<Timestamp>` | When the harness exited |
| `run_outcome` | `Option<AgentRunOutcome>` | Infrastructure outcome |
| `run_duration_secs` | `Option<u64>` | Wall-clock harness execution time |
| `harness` | `Option<String>` | Which harness was used |
| `input_tokens` | `u64` | Prompt/input tokens from post-run harness session extraction (`#[default(0)]`) |
| `output_tokens` | `u64` | Completion/output tokens from post-run harness session extraction (`#[default(0)]`) |

#### Scenario: Run metadata recorded

- **GIVEN** an issued action starts under harness `opencode`
- **WHEN** the daemon reports run start and finish metadata
- **THEN** the action row SHALL include `run_started_at`, `run_finished_at`, `run_duration_secs`, and `harness = Some("opencode")`

#### Scenario: Finish reducer persists tokens

- **WHEN** the daemon calls `report_action_run_finished` with `input_tokens = 5000` and `output_tokens = 1200`
- **THEN** the action row SHALL store those values alongside `run_finished_at` and `run_outcome`

### Requirement: AgentRunOutcome enum

A new `AgentRunOutcome` enum SHALL be defined with variants: `Clean`, `Signal`, `Timeout`, `SpawnFailed`.

This represents infrastructure outcome (how the harness process ended), distinct from logical action outcome (`ActionStatus`).

#### Scenario: Timeout outcome is infrastructure metadata

- **GIVEN** a harness process exceeds its configured timeout
- **WHEN** the daemon reports the run result
- **THEN** `run_outcome` SHALL be `Timeout`
- **AND** the logical action status SHALL remain controlled by action lifecycle reducers

### Requirement: set_dispatch_cooldown reducer

The `set_dispatch_cooldown` reducer SHALL allow an agent to set its own `dispatch_cooldown_secs` field.

- Caller must be the agent identified by the agent row matching `ctx.sender()`.
- Admin and Zoe roles SHALL also be allowed to set any agent's cooldown.

#### Scenario: Agent sets own cooldown

- **GIVEN** agent A calls `set_dispatch_cooldown(Some(900))`
- **WHEN** the reducer executes
- **THEN** agent A's `dispatch_cooldown_secs` SHALL be `Some(900)`

#### Scenario: Agent resets to inherit

- **GIVEN** agent A calls `set_dispatch_cooldown(None)`
- **WHEN** the reducer executes
- **THEN** agent A's `dispatch_cooldown_secs` SHALL be `None`, inheriting the global default


> Normative requirements for `probe action` commands.
