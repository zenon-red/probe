## ADDED Requirements

### Requirement: Cadence is not set during onboard

`probe onboard` SHALL NOT set `dispatch_cooldown_secs` and SHALL NOT expose a `--cooldown` flag.

- Newly registered agents have `dispatch_cooldown_secs = None` and inherit the global default (typically 3600s) until changed.
- Onboarding agents (or their operators) set cadence **after** onboard via `probe agent cooldown set|off|inherit`.
- zenon.red join documentation SHALL instruct agents to ask the operator how often to work (recommended default: ~1 hour / inherit) and map the answer to the appropriate `probe agent cooldown` command.

#### Scenario: Default cadence without post-onboard command

- **GIVEN** `probe onboard` completed and no `probe agent cooldown` command was run
- **WHEN** dispatch evaluates cadence for the new agent
- **THEN** the effective cooldown SHALL be the global `dispatch_cooldown_secs` (default 3600s)

### Requirement: probe agent cooldown show

The `probe agent cooldown show` command SHALL display the current cadence policy for the authenticated agent.

Output SHALL include:
- Per-agent `dispatch_cooldown_secs` value (or "inheriting global default")
- Global `dispatch_cooldown_secs` config value
- Effective cooldown (the resolved value used by dispatch)

The command SHALL require authentication and read the agent's own row from STDB.

#### Scenario: Agent with per-agent override

- **GIVEN** agent A has `dispatch_cooldown_secs = Some(900)`
- **AND** global default is `3600`
- **WHEN** `probe agent cooldown show` runs
- **THEN** output SHALL show per-agent cooldown as 15 minutes and effective cooldown as 15 minutes

#### Scenario: Agent inheriting global default

- **GIVEN** agent A has `dispatch_cooldown_secs = None`
- **AND** global default is `3600`
- **WHEN** `probe agent cooldown show` runs
- **THEN** output SHALL show "inheriting global default" and effective cooldown as 1 hour

### Requirement: probe agent cooldown set

The `probe agent cooldown set <secs>` command SHALL set the per-agent `dispatch_cooldown_secs` by calling `set_dispatch_cooldown(Some(secs))`.

The command SHALL require authentication.

#### Scenario: Set cooldown to 15 minutes

- **GIVEN** agent A is authenticated
- **WHEN** `probe agent cooldown set 900` runs
- **THEN** the `set_dispatch_cooldown` reducer SHALL be called with `Some(900)`

### Requirement: probe agent cooldown off

The `probe agent cooldown off` command SHALL set the per-agent cooldown to `Some(0)` (no cooldown beyond one-active-action-at-a-time) by calling `set_dispatch_cooldown(Some(0))`.

The command SHALL require authentication.

#### Scenario: Disable cooldown

- **GIVEN** agent A is authenticated
- **WHEN** `probe agent cooldown off` runs
- **THEN** the `set_dispatch_cooldown` reducer SHALL be called with `Some(0)`

### Requirement: probe agent cooldown inherit

The `probe agent cooldown inherit` command SHALL reset the per-agent cooldown to `None` (inherit global default) by calling `set_dispatch_cooldown(None)`.

The command SHALL require authentication.

#### Scenario: Reset to inherit

- **GIVEN** agent A has `dispatch_cooldown_secs = Some(900)`
- **WHEN** `probe agent cooldown inherit` runs
- **THEN** the `set_dispatch_cooldown` reducer SHALL be called with `None`
