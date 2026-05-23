## MODIFIED Requirements

### Requirement: Output modes (policy A)

The CLI SHALL support exactly two agent-consumable **success** output modes. Every command that succeeds with data SHALL use one of these — there SHALL be no per-command exceptions (lists, gets, and mutations all follow the same rule).

1. **TOON (default)** — the full `data` payload encoded with `@toon-format/toon` on **stdout** only (including single-row results such as `action complete` or `wallet delete`).
2. **JSON (`--json`)** — `{ "success": true, "data": <payload> }` on **stdout** only.

On failure, the CLI SHALL write errors to **stderr** and SHALL NOT write success payloads to stdout.

**Default-mode errors** SHALL be plain text on stderr: `{CODE}: {message}` and, when present, a second line `hint: {suggestion}`. Errors SHALL NOT be TOON-encoded.

**JSON-mode errors** SHALL be `{ "success": false, "error": { "code", "message", "suggestion?" } }` on stderr.

The CLI SHALL NOT use `@clack/prompts` or any spinner/progress UI in command handlers.

The CLI SHALL NOT write ad hoc plain-text success output to stdout (e.g. `Wallet:`, `Expires:`, “Next steps:”, `Deletion cancelled`). That information SHALL be included in `data` (and `next_commands` when applicable) and emitted via TOON or JSON.

Help panels SHALL be plain text with no ANSI escape sequences on stdout.

#### Scenario: Task list default output

- **WHEN** `probe task list` runs without `--json`
- **THEN** stdout SHALL contain TOON-encoded task data only
- **AND** stdout SHALL NOT contain clack formatting or spinner output

#### Scenario: Task list JSON output

- **WHEN** `probe task list --json` runs successfully
- **THEN** stdout SHALL contain `{ "success": true, "data": ... }`
- **AND** stderr SHALL be empty on success

#### Scenario: Auth failure JSON output

- **WHEN** `probe task list --json` runs without authentication
- **THEN** stderr SHALL contain `{ "success": false, "error": { "code", "message", ... } }`
- **AND** stdout SHALL be empty

### Requirement: Unified success emission

All commands that return structured success data SHALL use a single shared emission path (e.g. `emit`) so that default mode always writes TOON and `--json` always writes the JSON envelope. Commands SHALL NOT call `console.log` / `toonList` directly for primary output.

The legacy behavior where `success()` is a no-op in non-JSON mode SHALL be removed.

The emitter SHALL NOT choose output format based on command name, row count, or payload size.

#### Scenario: Action complete emits TOON in default mode

- **WHEN** `probe action complete <id>` succeeds without `--json`
- **THEN** stdout SHALL contain TOON encoding of the result `data` (e.g. `action_id`, `status`)
- **AND** stdout SHALL NOT contain a freeform plain-text sentence only

#### Scenario: Auth status emits TOON in default mode

- **WHEN** `probe auth status --wallet my-wallet` succeeds without `--json`
- **THEN** stdout SHALL contain TOON encoding of wallet/auth fields in `data`
- **AND** stdout SHALL NOT contain separate `Wallet:` / `Expires:` plain-text lines

#### Scenario: Default-mode error includes code

- **WHEN** a command fails with code `PASSWORD_REQUIRED` without `--json`
- **THEN** stderr SHALL include the code (e.g. `PASSWORD_REQUIRED: ...`)
- **AND** stderr SHALL NOT be TOON-encoded

### Requirement: Never prompt

The CLI SHALL NOT present interactive prompts for password, mnemonic, or confirmation.

When required input is missing and not provided via flags, files, or env, the command SHALL fail with a structured error naming the required flag or env var.

#### Scenario: Auth without password file in automation

- **WHEN** `probe auth my-wallet` runs without `--password-file`, without `PROBE_WALLET_PASSWORD`, and without `--json` requirement
- **THEN** the command SHALL fail with an error code such as `PASSWORD_REQUIRED`
- **AND** the error suggestion SHALL mention `--password-file` and `PROBE_WALLET_PASSWORD`
- **AND** the command SHALL NOT open an interactive password prompt

#### Scenario: Wallet delete without confirmation flag

- **WHEN** `probe wallet delete my-wallet` runs without `--yes`
- **THEN** the command SHALL fail with an error explaining `--yes` is required
- **AND** the command SHALL NOT prompt for confirmation

#### Scenario: Wallet delete with yes flag

- **WHEN** `probe wallet delete my-wallet --yes` runs
- **THEN** the wallet SHALL be deleted without any prompt

### Requirement: Password and mnemonic resolution

Password resolution order SHALL be:

1. `--password-file`
2. `PROBE_WALLET_PASSWORD` env var
3. Fail with `PASSWORD_REQUIRED` — interactive prompt is not permitted

Mnemonic resolution order SHALL be:

1. `--mnemonic` flag (if supported by command)
2. `--mnemonic-file`
3. `PROBE_WALLET_MNEMONIC` env var
4. Fail with `MNEMONIC_REQUIRED` — interactive prompt is not permitted

#### Scenario: Password from file

- **WHEN** `probe auth my-wallet --password-file /path/to/pass` runs
- **THEN** the password SHALL be read from the file
- **AND** no prompt SHALL occur

### Requirement: Next commands discoverability

Commands that complete a workflow step SHOULD include `next_commands` in JSON `data` and a TOON `next_commands` table in default mode when follow-up commands are known.

At minimum: `probe action show`, `probe task claim`, `probe auth` (after save), `probe onboard` (on success), and `probe doctor` (on failure) SHALL emit `next_commands`.

#### Scenario: Action show suggests context

- **WHEN** `probe action show <id> --json` runs for an action with `target_type = task`
- **THEN** `data` SHALL include `next_commands` containing `probe task get <id>` when applicable

### Requirement: Help discoverability

Bare `probe` (no subcommand) SHALL print concise help: short description, one or two example invocations, and instruction to run `probe --help` for the full command list.

`probe --help` SHALL print the full ACTIONS panel (current behavior).

Unknown top-level commands SHALL suggest the closest valid command name when within edit distance threshold.

Help panels SHALL include a documentation URL pointing to `docs/commands.md` (with anchor when applicable).

Help panels SHALL NOT contain ANSI escape sequences.

#### Scenario: Help is plain text

- **WHEN** `probe --help` runs
- **THEN** stdout SHALL NOT contain ANSI escape sequences

#### Scenario: Bare probe concise help

- **WHEN** `probe` runs with no arguments
- **THEN** output SHALL include a short usage summary
- **AND** SHALL instruct the user to run `probe --help` for the full list

#### Scenario: Typo suggestion

- **WHEN** `probe taks list` runs
- **THEN** stderr SHALL indicate the command is unknown
- **AND** SHALL suggest `probe task list` or equivalent

### Requirement: Doctor issues

`probe doctor` SHALL emit `data.issues[]` with stable `code`, `severity`, `message`, and optional `recommendation` and `fix_command`.

`ok` SHALL be false when any issue has severity `fail`. The command SHALL exit 1 when `ok` is false.

Registration checks SHALL run by default; `--no-agent` SHALL skip them.

`--fix` SHALL apply safe automated fixes only and SHALL NOT prompt or mutate secrets.

#### Scenario: Doctor reports AUTH_TOKEN_MISSING

- **WHEN** `probe doctor --json` runs without a cached token
- **THEN** `data.issues` SHALL include `AUTH_TOKEN_MISSING`
- **AND** exit code SHALL be 1

### Requirement: Exit codes

The CLI SHALL use non-zero exit codes mapped to failure classes:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Generic / unexpected failure |
| 2 | Authentication / authorization (`AUTH_REQUIRED`, `UNAUTHORIZED`, …) |
| 3 | Connection / timeout (`CONNECTION_ERROR`, `SQL_UNAVAILABLE`, …) |
| 4 | Validation / invalid input (`INVALID_*`, `SQL_INVALID`, …) |
| 5 | Not found (`*_NOT_FOUND`, …) |

#### Scenario: Auth required exit code

- **WHEN** a command fails with `AUTH_REQUIRED`
- **THEN** exit code SHALL be 2

## ADDED Requirements

### Requirement: Agent documentation artifact

The repository SHALL include `docs/llms.txt` describing: policy A (TOON on all success, text errors on stderr), `--json` envelope, never-prompt policy, common commands, error code list, and exit code map.

Skills and `docs/commands.md` SHALL reference `docs/llms.txt`.

#### Scenario: llms.txt exists

- **WHEN** an agent or operator opens `docs/llms.txt`
- **THEN** it SHALL document that stdout is data-only and prompts are not supported

## REMOVED Requirements

### Requirement: Clack interactive UI

**Reason**: Probe is agent-only; clack pollutes stdout/stderr and encourages interactive flows incompatible with automation.

**Migration**: Use `--json` or default TOON for data; use flags/files for secrets; use `--yes` for destructive confirmation. Daemon output is JSONL on stdout only.

### Requirement: TTY-gated interactive prompts

**Reason**: TTY detection is an unreliable proxy for “human vs agent”; never-prompt is the explicit policy.

**Migration**: Pass `--password-file`, `PROBE_WALLET_PASSWORD`, `--mnemonic-file`, `PROBE_WALLET_MNEMONIC`, or `--yes` as documented in error suggestions.
