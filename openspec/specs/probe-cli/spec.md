# Probe CLI

## Purpose

The probe command-line interface SHALL provide structured, non-interactive access to wallets, authentication, SpacetimeDB nexus data, and agent workflows. Successful commands emit machine-readable output on stdout; failures emit structured errors on stderr without interactive prompts.

## Requirements

### Requirement: Unified success output encoding

Every successful command SHALL emit structured success data on stdout using a single policy: TOON encoding by default, or a JSON envelope when `--json` is set.

#### Scenario: Default TOON success

- **WHEN** a command completes successfully without `--json`
- **THEN** stdout SHALL contain the full `data` payload encoded as TOON
- **AND** stderr SHALL be empty

#### Scenario: JSON success envelope

- **WHEN** a command completes successfully with `--json`
- **THEN** stdout SHALL contain `{ "success": true, "data": <payload> }`
- **AND** stderr SHALL be empty

#### Scenario: Workflow hints

- **WHEN** a command includes optional `next_commands` in its result
- **THEN** those hints SHALL appear inside the structured `data` payload

### Requirement: Structured error rendering at CLI boundary

Command handlers SHALL throw `ProbeError` for failures. Only the CLI boundary SHALL render errors and exit the process.

#### Scenario: Default-mode error

- **WHEN** a command fails without `--json`
- **THEN** stderr SHALL contain `{CODE}: {message}` and optional `hint: {suggestion}`
- **AND** stdout SHALL be empty

#### Scenario: JSON-mode error

- **WHEN** a command fails with `--json`
- **THEN** stderr SHALL contain `{ "success": false, "error": { "code", "message", "suggestion?" } }`
- **AND** stdout SHALL be empty

### Requirement: Non-interactive CLI

The CLI SHALL NOT use interactive prompts, spinners, or ANSI/color in help text. Secrets and confirmations SHALL require flags, environment variables, or `--yes`.

#### Scenario: Missing wallet password

- **WHEN** a wallet operation needs a password
- **AND** neither `--password-file` nor `PROBE_WALLET_PASSWORD` is provided
- **THEN** the command SHALL fail with `PASSWORD_REQUIRED`
- **AND** SHALL NOT prompt on stdin

#### Scenario: Plain-text help

- **WHEN** the user runs `probe --help` or a subcommand `--help`
- **THEN** help text SHALL be plain text on stdout without escape sequences

### Requirement: SpacetimeDB connection option forwarding

CLI commands SHALL forward only explicit `wallet`, `host`, and `module` options to `CommandContext.create`. Unspecified values SHALL be resolved from merged probe configuration.

#### Scenario: Explicit host override

- **GIVEN** the user passes `--host ws://127.0.0.1:3000`
- **WHEN** a command opens a SpacetimeDB connection
- **THEN** the connection SHALL use the provided host
- **AND** SHALL NOT require the default config host to match

### Requirement: Message target resolution

Message list and send commands SHALL resolve targets consistently: numeric-only identifiers refer to projects; non-numeric identifiers refer to channels; `channel:<id>` disambiguates numeric channel ids.

#### Scenario: Numeric project target

- **GIVEN** target `42` where `42` is a project id
- **WHEN** `probe message list 42` runs
- **THEN** the command SHALL query project messages for project `42`

#### Scenario: Channel name target

- **GIVEN** target `general` matching a channel name
- **WHEN** `probe message send general "hello"` runs
- **THEN** the command SHALL send to the `general` channel

### Requirement: Citty subcommand dispatch

Nexus command groups, `config`, and `token` SHALL use citty subcommands. Authentication entry points SHALL be `probe login <wallet>` and `probe auth status` only (no `auth login`).

#### Scenario: Unknown subcommand rejected

- **WHEN** the user runs `probe task unknown`
- **THEN** the CLI SHALL fail with a structured error before connecting to SpacetimeDB

#### Scenario: Boolean flags do not consume subcommand tokens

- **WHEN** the user runs `probe action --json show 42`
- **THEN** the CLI SHALL dispatch to `probe action show` with id `42`

### Requirement: SQL query decode policy

`probe query` SHALL decode row values when table inference from the SQL string is unambiguous; otherwise it SHALL return raw rows with decode metadata.

#### Scenario: Ambiguous SQL returns raw rows

- **GIVEN** a SQL statement where table name inference is ambiguous
- **WHEN** `probe query` runs without `--raw`
- **THEN** output SHALL include raw row arrays and metadata indicating decode was skipped

### Requirement: Generated enum decoder parity

Generated enum decoders SHALL match the SpacetimeDB module binding enums. CI SHALL fail when decoder output drifts from `module_bindings` types.

#### Scenario: Schema drift detected in CI

- **GIVEN** a generated decoder disagrees with `module_bindings/types.ts`
- **WHEN** the schema drift test runs
- **THEN** the test SHALL fail
