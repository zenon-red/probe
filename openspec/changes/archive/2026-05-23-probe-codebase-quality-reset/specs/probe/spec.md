## ADDED Requirements

### Requirement: Message target resolution

Message commands SHALL resolve targets through a single shared model with explicit disambiguation rules:

- **Numeric-only input** (e.g. `"42"`) → project lookup by id (preserves current behavior)
- **Non-numeric input** → channel lookup by name (exact match) or channel id string match
- **Prefixed input** → explicit disambiguation:
  - `project:<id>` → project lookup
  - `channel:<name>` or `channel:<id>` → channel lookup (required when target is a numeric channel id)

Pure numeric strings SHALL NOT resolve to channels. Numeric channel targets MUST use the `channel:<id>` prefix.

#### Scenario: Numeric project target

- **WHEN** target input is `"42"` and project id 42 exists
- **THEN** resolution SHALL yield `{ kind: "project", projectId: 42n, projectName }`

#### Scenario: Named channel target

- **WHEN** target input is `"general"` and a channel named `general` exists
- **THEN** resolution SHALL yield `{ kind: "channel", channelId, channelName: "general" }`

#### Scenario: Numeric channel requires prefix

- **WHEN** target input is `"7"` and channel id 7 exists but no project id 7 exists
- **THEN** resolution SHALL fail with an appropriate error
- **AND** SHALL suggest using `channel:7` for explicit channel targeting

#### Scenario: Prefixed numeric channel

- **WHEN** target input is `"channel:7"` and channel id 7 exists
- **THEN** resolution SHALL yield `{ kind: "channel", channelId: 7n, channelName }`

#### Scenario: Missing project

- **WHEN** target input is a numeric id with no matching project
- **THEN** the command SHALL fail with an appropriate error code

#### Scenario: Missing channel

- **WHEN** target input is a non-numeric string with no matching channel
- **THEN** the command SHALL fail with an appropriate error code

### Requirement: Shared message list flow

`message list` and `message directives` SHALL share one list function parameterized by message kind (`user` vs `directive`), differing only in the message-type predicate.

#### Scenario: List and directives use same sort/limit

- **GIVEN** the same target and limit
- **WHEN** `message list` and `message directives` run
- **THEN** both SHALL apply identical retrieval, sort, and limit logic
- **AND** results SHALL differ only by message type filter

### Requirement: Shared message send flow

`message send` and `message directive` SHALL share one send function parameterized by message type policy.

#### Scenario: Send and directive share target resolution

- **WHEN** `message send` and `message directive` receive the same target
- **THEN** both SHALL use the same target resolver before calling reducers

### Requirement: Nexus command subcommands

All six nexus command groups SHALL use explicit citty subcommands. Each subcommand SHALL declare only its own accepted args. Positional `action` arguments and shared mega-arg interfaces SHALL be removed.

Subcommands:

- **message**: `list`, `directives`, `send`, `directive`, `channels`
- **task**: `list`, `ready`, `get`, `create`, `claim`, `update`, `review`, `deps`, `watch`
- **agent**: `register`, `status`, `set-status`, `capabilities`, `me`, `bio`, `heartbeat`, `list`, `identity`, `voice`
- **project**: `list`, `get`, `status`, `create`, `set-status`
- **idea**: `list`, `pending`, `get`, `dimensions`, `propose`, `vote`
- **discover**: `report`, `review`, `list`, `get`

#### Scenario: Parent help is plain text without ANSI

- **WHEN** `probe task --help` is run
- **THEN** help output SHALL use the project's `printHelp` formatter
- **AND** SHALL NOT contain ANSI escape sequences from citty

#### Scenario: Unknown subcommand returns structured JSON error

- **GIVEN** `--json` mode is active
- **WHEN** user runs `probe task bogus`
- **THEN** stderr SHALL contain the JSON envelope `{ success: false, error: { code, message, suggestion? } }`
- **AND** SHALL NOT print citty's colored unknown-command help

#### Scenario: Subcommand help is scoped

- **WHEN** `probe task create --help` is run
- **THEN** help SHALL show only args relevant to create (e.g. `--project`, `--title`)
- **AND** SHALL NOT list unrelated subcommand flags

#### Scenario: Agent subcommand help is scoped

- **WHEN** `probe agent register --help` is run
- **THEN** help SHALL show only register-relevant args
- **AND** SHALL NOT expose a shared positional `action` argument

#### Scenario: Project subcommands replace switch dispatch

- **WHEN** `probe project list` runs
- **THEN** execution SHALL route to the `list` subcommand handler
- **AND** SHALL NOT use a parent-level `switch (action)` over shared args

### Requirement: Login, config, and token commands

Commands that use positional action dispatch or overloaded positional patterns SHALL convert to explicit citty subcommands:

- **config**: `get`, `set`, `list` (replaces positional `action` switch)
- **login** (top-level): authenticate wallet and cache OIDC token
- **auth**: `status` only (inspect cached authentication)
- **token**: `show`, `clear`

Commands that already use citty `subCommands` (`action`, `wallet`, `cooldown`) SHALL remain unchanged except for shared plumbing (host/module, ProbeError).

Single-purpose commands (`query`, `doctor`, `whoami`, `onboard`, `upgrade`, `sign`, `nexus`) SHALL NOT require subcommand conversion.

#### Scenario: Config subcommand declares only its args

- **WHEN** `probe config set --help` is run
- **THEN** help SHALL show only set-relevant args (key, value)
- **AND** SHALL NOT document a positional `<action>` on the parent command

#### Scenario: Top-level login command

- **WHEN** user runs `probe login my-wallet --password-file ./pass --save`
- **THEN** the OIDC authentication flow SHALL execute
- **AND** `probe auth login` SHALL NOT be a valid command

#### Scenario: Auth status subcommand

- **WHEN** user runs `probe auth status --wallet my-wallet`
- **THEN** cached token status SHALL be returned
- **AND** SHALL NOT use `probe auth status` as a magic wallet-name positional

#### Scenario: Token show and clear

- **WHEN** user runs `probe token show my-wallet` or `probe token clear my-wallet`
- **THEN** the respective operation SHALL execute
- **AND** parent command SHALL NOT use `--clear` flag as a mode switch

### Requirement: Canonical connection options helper

The CLI SHALL provide one helper that converts command arguments into `CommandContextOptions`, forwarding only explicitly provided `wallet`, `host`, and `module` values. The helper SHALL NOT read config or resolve defaults — that remains `CommandContext.create`'s responsibility.

#### Scenario: All three overrides forwarded

- **GIVEN** command args `{ wallet: "a", host: "ws://custom:3000", module: "nexus-dev" }`
- **WHEN** `commandContextOptions(args)` is called
- **THEN** the result SHALL include all three values

#### Scenario: Omitted flags stay undefined

- **GIVEN** command args `{ wallet: "a" }` with no host or module
- **WHEN** `commandContextOptions(args)` is called
- **THEN** the result SHALL include `wallet: "a"`
- **AND** `host` and `module` SHALL be undefined (not populated from config)

#### Scenario: Config defaults applied by CommandContext

- **GIVEN** `commandContextOptions({ wallet: "a" })` passed to `CommandContext.create`
- **WHEN** connection resolves host and module
- **THEN** `CommandContext.create` SHALL apply config defaults for any undefined host/module

### Requirement: Host and module flags reach connection layer

Every command that declares `--host` or `--module` in its argument definition SHALL forward those values through the canonical helper to `CommandContext.create` or `withAuth`.

#### Scenario: Read command forwards host override

- **GIVEN** `probe task list --host ws://127.0.0.1:3000`
- **WHEN** the handler opens a connection
- **THEN** `CommandContext.create` SHALL receive `host: "ws://127.0.0.1:3000"`

#### Scenario: Write command forwards module override

- **GIVEN** `probe task create --module nexus-dev` with required create args
- **WHEN** the handler calls `withAuth`
- **THEN** the auth context SHALL connect to module `nexus-dev`

### Requirement: Typed ProbeError and exit boundary

The CLI SHALL define a `ProbeError` class carrying `code`, `message`, optional `suggestion`, and `exitCode`. Command handlers SHALL NOT call `process.exit` for expected failures; fatal rendering and process exit SHALL occur only through a shared boundary renderer.

#### Scenario: Handler throws instead of exiting

- **GIVEN** a command handler encounters invalid input
- **WHEN** validation fails
- **THEN** the handler SHALL throw `ProbeError`
- **AND** `process.exit` SHALL NOT be called in the handler

#### Scenario: JSON error rendering at boundary

- **GIVEN** `--json` mode is active
- **AND** a `ProbeError` propagates to the CLI boundary
- **WHEN** the error is rendered
- **THEN** stderr SHALL contain the JSON envelope `{ success: false, error: { code, message, suggestion? } }`

#### Scenario: Catch blocks rethrow ProbeError

- **GIVEN** a command catch block uses connection/unexpected failure mapping
- **WHEN** a `ProbeError` (e.g. `TASK_NOT_FOUND`) is caught
- **THEN** the handler SHALL rethrow it unchanged
- **AND** SHALL NOT wrap it as `UNEXPECTED_ERROR`

### Requirement: Enum decoder parity with bindings

For every enum in `src/module_bindings/types.ts`, generated SQL enum decoders SHALL expose the same variant names in the same order. Drift tests SHALL work on fresh checkout via generator import or pretest generation.

#### Scenario: Drift fails unit test

- **GIVEN** generated decoders contain stale enum variants
- **WHEN** the schema drift unit test runs
- **THEN** the test SHALL fail with a diff of mismatched enum names

#### Scenario: Fresh checkout build and test

- **GIVEN** `src/generated/decoders.ts` does not exist
- **WHEN** `npm run build` or `npm run test:ci` runs
- **THEN** decoders SHALL be generated before compile or test execution

### Requirement: Safe SQL table inference

`probe query` SHALL classify SQL into decode-safe and decode-unsafe shapes before applying table decoders. Ambiguous SQL SHALL NOT be silently mis-decoded.

#### Scenario: Simple select is unambiguous

- **WHEN** SQL is `SELECT * FROM tasks LIMIT 5`
- **THEN** inference SHALL classify as unambiguous with table `tasks`

#### Scenario: Join is ambiguous

- **WHEN** SQL contains a JOIN between two tables
- **THEN** inference SHALL classify as ambiguous
- **AND** output SHALL include metadata that decoding was skipped unless `--raw` is set

#### Scenario: Help documents decode limitations

- **WHEN** user runs `probe query --help`
- **THEN** help SHALL mention decode limitations for joins and multi-statement SQL

### Requirement: Read commands subscribe to typed tables

Every command that reads typed getters (`ctx.tasks`, `ctx.projects`, etc.) SHALL pass an explicit `subscribe` list including the required tables.

#### Scenario: Task get subscribes to tasks

- **WHEN** `probe task get <id>` opens a connection
- **THEN** subscriptions SHALL include `SELECT * FROM tasks`

#### Scenario: Project list subscribes to projects

- **WHEN** `probe project list` opens a connection
- **THEN** subscriptions SHALL include `SELECT * FROM projects`

### Requirement: Daemon module decomposition

Daemon behavior SHALL live in focused modules under `src/daemon/`:

- `events.ts` — event types, JSON sanitization, log filtering, sinks
- `harness-runner.ts` — spawn, timeout, outcome mapping
- `session.ts` — authenticated connection, agent lookup, subscriptions
- `action-executor.ts` — prompt construction, reducer reporting, harness integration
- `loop.ts` — reconnect/backoff, signals, heartbeat

`src/commands/nexus-daemon.ts` SHALL remain a thin CLI wrapper (args, help, entry).

#### Scenario: Stable JSONL event names

- **WHEN** daemon modules are extracted
- **THEN** existing JSONL event names emitted to stdout SHALL remain unchanged

#### Scenario: One action at a time

- **WHEN** multiple issued actions exist for the agent
- **THEN** the daemon SHALL execute at most one action at a time (same as pre-refactor behavior)

#### Scenario: Spawn violation event preserved

- **WHEN** harness spawn rules are violated (e.g. concurrent spawn attempt)
- **THEN** the daemon SHALL emit the same spawn-violation event type and payload shape as before refactor

#### Scenario: Heartbeat cadence preserved

- **WHEN** the daemon loop runs with default config
- **THEN** heartbeat scheduling SHALL preserve existing cadence and jitter behavior

#### Scenario: Non-fatal reducer reporting failures

- **WHEN** `run-started` or `run-finished` reducer calls fail
- **THEN** the daemon SHALL log the failure and continue (non-fatal), matching pre-refactor behavior

#### Scenario: Harness outcome semantics preserved

- **WHEN** harness exits cleanly, with non-zero code, signal, timeout, or spawn failure
- **THEN** outcome mapping to `AgentRunOutcome` variants SHALL match pre-refactor semantics

#### Scenario: Harness runner unit testable

- **WHEN** harness runner is tested with mocked spawn
- **THEN** outcomes Clean, Signal, Timeout, and SpawnFailed SHALL be mappable without a live SpacetimeDB connection

### Requirement: CommandContext boundary cleanup

`CommandContext.create` SHALL NOT mutate global `console.log` or `console.error`. It SHALL NOT use `identity: undefined as unknown as Identity` before connection completes.

#### Scenario: No console mutation

- **WHEN** `CommandContext.create` runs
- **THEN** global console methods SHALL remain unchanged after connect completes

#### Scenario: Identity available after connect

- **WHEN** connection and subscription succeed
- **THEN** callers requiring auth identity SHALL receive the connected identity, not a placeholder

### Requirement: Typed table accessors from STDB bindings

`CommandContext` SHALL expose typed getters for tables read by CLI commands, using row types from `module_bindings/types.ts` and iterators from `conn.db.<table>.iter()`.

Minimum getters (non-exhaustive): `agents`, `agentActions`, `tasks`, `taskDependencies`, `projects`, `ideas`, `votes`, `evaluationDimensions`, `messages`, `channels`, `projectMessages`, `projectChannels`, `discoveredTasks`, `config`.

Command handlers SHALL use typed getters instead of `ctx.iter<T>(tableName)` or ad-hoc `ctx.db as Record<string, …>` casts.

#### Scenario: Tasks read via typed getter

- **WHEN** a command handler needs all tasks
- **THEN** it SHALL use `ctx.tasks` (or equivalent typed getter)
- **AND** SHALL NOT call `ctx.iter<Task>("tasks")`

#### Scenario: Agent actions read via typed getter

- **WHEN** `probe action` reads agent action rows
- **THEN** it SHALL use `ctx.agentActions` with binding row types
- **AND** SHALL NOT cast `ctx.db` to an untyped record

#### Scenario: No public stringly table access after migration

- **WHEN** command handler migration is complete
- **THEN** public `iter<T>(tableName: string)` on `CommandContext` SHALL be removed or made private
- **AND** all CLI table reads SHALL go through typed getters

### Requirement: Reducer command wrapper

Repeated authenticated reducer patterns SHALL use a small explicit helper that keeps parameter construction and business validation at the call site.

#### Scenario: Reducer failure maps to REDUCER_FAILED

- **GIVEN** a reducer call that throws
- **WHEN** executed through the wrapper
- **THEN** the failure SHALL surface as `REDUCER_FAILED` with the reducer error message

### Requirement: Expanded unit test coverage in CI

`npm run test:ci` SHALL execute the high-risk unit tests including schema drift, connection target propagation, message target resolution, daemon harness outcomes, typed error rendering, and SQL decode edge cases. Test CI SHALL run `generate:decoders` before tests (gitignored generated output).

#### Scenario: CI runs full unit suite

- **WHEN** CI executes `test:ci`
- **THEN** all test files under `tests/unit/` relevant to this change SHALL run
- **AND** SHALL NOT be limited to config and sql endpoint tests only

#### Scenario: CI generates decoders before tests

- **WHEN** CI executes `test:ci` on a fresh checkout
- **THEN** decoder generation SHALL run before unit tests

### Requirement: Action ownership verification tests

Unit tests SHALL cover action ownership verification and wrong-route handling for `probe action` commands.

#### Scenario: Wrong agent cannot complete action

- **GIVEN** an action owned by a different agent identity
- **WHEN** ownership verification runs
- **THEN** the command SHALL fail with an ownership-related error code

## REMOVED Requirements

### Requirement: Positional action dispatch

**Reason**: Replaced by explicit citty subcommands for nexus groups plus config, auth, and token. Heavy dev — no backward compatibility shims.

**Migration**: Use subcommand form. Examples: `probe login my-wallet`, `probe auth status`, `probe task list`, `probe config get spacetime.host`, `probe token show my-wallet`. Removed: `probe auth login`, bare `probe auth <wallet>`.

#### Scenario: No positional action arg on parent command

- **WHEN** `probe task --help` is run
- **THEN** help SHALL list subcommands (list, ready, get, …)
- **AND** SHALL NOT document a positional `<action>` argument on the parent command

### Requirement: Dynamic iter table access

**Reason**: Replaced by typed getters sourced from generated STDB bindings.

**Migration**: Replace `ctx.iter<T>("table")` with `ctx.<tableGetter>`. Types come from `module_bindings/types.ts`.

#### Scenario: Typo fails at compile time

- **WHEN** a developer accesses a non-existent table getter on `CommandContext`
- **THEN** TypeScript SHALL fail at compile time
- **AND** SHALL NOT silently return an empty array from a mistyped string table name
