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

### Requirement: Post-upgrade genesis toolchain report

When local genesis is configured (`genesisHash` or `genesisSource` in user config), `probe upgrade` SHALL report genesis-pinned toolchain status in `data.toolchain` with components:

- `probe` — installed semver and optional `expected` from `minProbeVersion`; `status` `ok` or `warn`
- `openspec` — when `openspecVersion` is pinned: `expected`, optional `installed`, `status` (`ok` | `warn` | `unknown`)
- `skills` — when skills source/ref are configured: `expected` as `source@ref`, optional `installed`, `status` (`ok` | `warn` | `unknown`)

With `--check`, the command SHALL build the toolchain report without installing. With `--yes` and a configured genesis, the command SHALL attempt OpenSpec and skills installs before building the final report.

Install failures during sync SHALL add `data.warnings` strings. Toolchain reporting SHALL be warn-only (MUST NOT change exit code on mismatch).

Lock file resolution for skills SHALL match Skills CLI behavior:

1. `$XDG_STATE_HOME/skills/.skill-lock.json` when `XDG_STATE_HOME` is set
2. Otherwise `~/.agents/.skill-lock.json`

Skills `status`: `ok` when every matching lock entry has the expected ref; `warn` on ref mismatch or missing ref; `unknown` when lock missing/unreadable or no matching entries.

#### Scenario: Toolchain report after upgrade with genesis

- **GIVEN** `probe upgrade --yes` succeeds with local genesis configured
- **WHEN** the command finishes
- **THEN** JSON output SHALL include `data.toolchain.skills.status`
- **AND** `data.toolchain.probe.status` SHALL be present

#### Scenario: Check-only includes toolchain without sync

- **GIVEN** `probe upgrade --check --json` with local genesis configured
- **WHEN** the command completes
- **THEN** the result SHALL include `data.toolchain`
- **AND** the command SHALL NOT run global npm/npx installs for toolchain sync

#### Scenario: Skills ref mismatch in toolchain report

- **GIVEN** genesis pins `zenon-red/skills` at ref `v1.0.0`
- **AND** the global lock has a matching entry with a different ref
- **WHEN** `probe upgrade --check --json` completes
- **THEN** `data.toolchain.skills.status` SHALL be `warn`

### Requirement: Toolchain human output

When `probe upgrade` runs without `--json` and a toolchain report is built, human-readable toolchain lines SHALL be written to stderr only. The TOON success payload on stdout SHALL NOT include `toolchain`.

`data.warnings` entries SHALL be printed to stderr with a leading warning marker in human mode.

#### Scenario: Toolchain lines on stderr

- **GIVEN** `probe upgrade --yes` without `--json` and local genesis configured
- **WHEN** the command completes
- **THEN** stderr SHALL contain toolchain summary lines (`probe`, and `openspec`/`skills` when configured)
- **AND** stdout SHALL contain only the structured upgrade success payload without `toolchain`

### Requirement: Toolchain JSON output

When `probe upgrade --json` completes, the JSON success envelope on stdout SHALL include `data.toolchain` with `genesisConfigured`, `probe`, and optional `openspec` and `skills` component objects (`expected`, `installed`, `status`, optional `message`, optional `fixCommand`).

Optional `data.warnings` SHALL be a string array when install steps failed.

The command SHALL NOT print human toolchain prose to stderr when `--json` is set (except structured errors).

#### Scenario: JSON includes toolchain

- **GIVEN** `probe upgrade --yes --json` succeeds with genesis configured
- **WHEN** the command completes
- **THEN** stdout SHALL contain `{ "success": true, "data": { ..., "toolchain": { ... } } }`

### Requirement: Skills ref release reminder script

Probe SHALL provide `npm run check:skills-ref` for maintainers (`npx tsx scripts/check-skills-ref.ts`). The script SHALL read `EXPECTED_SKILLS_REF` from `src/utils/skills-check.ts` and compare it to the latest `v*` git tag on `zenon-red/skills`.

Default (warn) mode SHALL exit `0` and print a stderr reminder when the latest skills tag differs from `EXPECTED_SKILLS_REF`.

Strict mode (`--strict`) SHALL exit non-zero on tag mismatch or when the latest tag cannot be determined, for use in release automation.

The script SHALL NOT modify source files or bump the constant automatically.

#### Scenario: Warn when skills repo is ahead

- **GIVEN** `EXPECTED_SKILLS_REF` in probe is `v0.3.3`
- **AND** the latest `zenon-red/skills` git tag is `v0.3.4`
- **WHEN** `npm run check:skills-ref` runs without `--strict`
- **THEN** the command SHALL exit `0`
- **AND** stderr SHALL mention both refs and bumping `src/utils/skills-check.ts`

#### Scenario: Release workflow fails on mismatch

- **GIVEN** `EXPECTED_SKILLS_REF` does not equal the latest `zenon-red/skills` `v*` tag
- **WHEN** `npm run check:skills-ref -- --strict` runs in CI
- **THEN** the command SHALL exit non-zero
- **AND** the release workflow SHALL not publish until the constant is bumped or the mismatch is resolved

#### Scenario: Strict mode fails when latest tag is unknown

- **GIVEN** the latest `zenon-red/skills` `v*` tag cannot be determined
- **WHEN** `npm run check:skills-ref -- --strict` runs in CI
- **THEN** the command SHALL exit non-zero

#### Scenario: Refs match

- **GIVEN** `EXPECTED_SKILLS_REF` equals the latest `zenon-red/skills` `v*` tag
- **WHEN** `npm run check:skills-ref` runs in warn or strict mode
- **THEN** the command SHALL exit `0`
- **AND** stderr SHALL not print a mismatch warning
