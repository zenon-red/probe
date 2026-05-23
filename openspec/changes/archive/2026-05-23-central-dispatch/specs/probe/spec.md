## MODIFIED Requirements

### Requirement: Onboard step changes

The `probe onboard` command SHALL replace the scheduler configuration step (step 14) with a harness configuration step.

- The `--scheduler` flag SHALL be removed.
- The `--wake-interval` flag SHALL be removed.
- A `--harness` flag SHALL be added with values: `auto`, `pi`, `hermes`, `openclaw`, `opencode`, `custom`.
- When `--harness` is `custom`, a `--harness-command` flag SHALL be required.
- The `configureScheduler` step SHALL be replaced with `configureHarness` which detects and configures the harness.
- `probe onboard` SHALL remain **non-interactive** (no clack prompts). Agents invoke it with flags such as `--name`, `--harness`, `--agent-id`, `--json`.
- `probe onboard` SHALL NOT include a `--cooldown` flag or any onboard step that sets dispatch cooldown.
- Cadence is configured **after** successful onboard via `probe agent cooldown` (see zenon.red join guidance). New agents default to inheriting the network global (`dispatch_cooldown_secs = None` → typically 3600s).

#### Scenario: Auto-detect harness

- **GIVEN** `--harness auto` (or no flag)
- **AND** `hermes` is detected in PATH
- **WHEN** onboard runs the harness step
- **THEN** config SHALL be written with `harness: "hermes"`

#### Scenario: Explicit harness

- **GIVEN** `--harness openclaw`
- **WHEN** onboard runs the harness step
- **THEN** config SHALL be written with `harness: "openclaw"` regardless of detection

#### Scenario: Post-onboard cadence via agent cooldown

- **GIVEN** `probe onboard` completed successfully and the operator wants ~1 hour between action starts (network default)
- **WHEN** the onboarding agent takes no cooldown action
- **THEN** the agent SHALL inherit the global `dispatch_cooldown_secs` (default 3600s)
- **AND** no `set_dispatch_cooldown` call is required

#### Scenario: Post-onboard cadence override

- **GIVEN** `probe onboard` completed successfully
- **AND** the operator asked for work every 15 minutes
- **WHEN** the onboarding agent runs `probe agent cooldown set 900`
- **THEN** the `set_dispatch_cooldown` reducer SHALL be called with `cooldown_secs = 900`

### Requirement: CommandContext subscription narrowing

`CommandContext` SHALL support explicit per-command subscriptions instead of subscribing to all Nexus tables by default.

- `subscribe` option: `string[]` of SQL queries, or `subscribeFactory(identity) => string[]`
- **Default** when neither is provided: `SELECT * FROM agents` and `SELECT * FROM config` only (not 15 tables)
- **Reducer-only writes** MAY pass `subscribe: []`
- Each command SHALL subscribe only to tables it reads

#### Scenario: Task list subscribes to tasks only

- **GIVEN** `probe task list` runs
- **WHEN** `CommandContext` is created
- **THEN** the subscription SHALL include `tasks` (and not require messages, ideas, or other tables)

### Requirement: Typed reducer invocation

`callReducer` and `callProcedure` SHALL accept typed SDK reducer/procedure functions (e.g. `ctx.conn.reducers.updateAgentAction`) rather than string reducer names.

### Requirement: Removed commands and config

The following SHALL be removed:
- `probe next` command
- `src/utils/next-router.ts`
- `src/commands/next.ts`
- `src/utils/next-action-defs.ts`
- `src/utils/runtime-detection.ts`
- `src/utils/scheduler-plans.ts`
- `schedulerConfirmed` config field
- `wakeIntervalMs` config field

#### Scenario: probe next removed

- **GIVEN** the `central-dispatch` change is deployed
- **WHEN** `probe next` is invoked
- **THEN** the command SHALL not exist (unknown command error)

### Requirement: Deleted STDB reducer

The `issue_agent_action` reducer SHALL be deleted. All action issuance SHALL go through `issue_action` (internal function) called by `dispatch_tick` and future wakeup reducers.

#### Scenario: issue_agent_action not callable

- **GIVEN** the `central-dispatch` change is deployed
- **WHEN** a client attempts to call `issue_agent_action`
- **THEN** the reducer SHALL not exist

### Requirement: update_agent_action no longer sets Agent.status

The `update_agent_action` reducer SHALL NOT modify `Agent.status` or `Agent.current_task_id`. Agent liveness and work state are separate concerns.

#### Scenario: Action completed without agent status change

- **GIVEN** agent A has `status = Online`
- **AND** action #42 for agent A is completed via `update_agent_action`
- **WHEN** the reducer completes
- **THEN** agent A's `status` SHALL remain `Online` (unchanged)
