## Context

Probe commands today scatter output across TOON `console.log`, clack UI, and freeform strings. Agents and skills assume parseable stdout; clack and prompts break that contract. This change is probe-only — no Nexus/STDB work.

Reference: conversation + `research.md`; clig.dev informed scope but several recommendations explicitly dropped.

## Goals / Non-Goals

**Goals:**

- **Policy A (output):** every successful command emits structured data the same way — **TOON on stdout (default)** or **JSON envelope (`--json`)**. No per-command format matrix (no plain-text acks, no TOON-on-errors).
- Single `emit()` path — commands pass a `data` object; encoder chooses TOON vs JSON from mode only.
- stderr for errors only (plus existing `probe nexus --pretty` daemon lifecycle logs on stderr)
- Never prompt — all secrets/choices via flags, files, env, `--yes`
- Generalize `next_commands` for workflow discoverability
- Improve help: concise default, typo hints, doc links
- Publish `llms.txt` for agent context
- Map exit codes for automation

**Non-Goals:**

- `--plain`, color/TNO_COLOR policy, `--no-input`, `--quiet`
- Man pages, pager, XDG migration
- Per-command output format rules (e.g. TOON for lists but plain text for `action complete`) — uniform TOON on success instead
- TOON or JSON on stderr for errors — errors stay plain text with `CODE:` + optional `hint:`
- Rewriting citty subcommand structure (`probe task list` vs nested subcommands)

## Cross-repo Scope

None. Self-contained in `probe`.

## Essential State

**CommandResult** (per invocation, not persisted):

| Attribute | Type | Constraint |
|-----------|------|------------|
| `success` | boolean | true on zero exit |
| `data` | optional structured value | Present on success; encoded TOON or nested in JSON envelope |
| `error_code` | optional string | Present on failure |
| `error_message` | optional string | Human/agent readable |
| `error_suggestion` | optional string | Actionable fix |
| `next_commands` | optional string[] | Suggested follow-up CLI lines |

**InputResolution** (per sensitive command):

| Source | Precedence |
|--------|------------|
| `--password-file` / `--mnemonic-file` | Highest |
| `--password` / `--mnemonic` flags (if any exist) | Next |
| `PROBE_WALLET_*` env | Next |
| Interactive prompt | **Forbidden** |

**Integrity:** On success with data, stdout SHALL contain exactly one encoded payload (TOON document or JSON envelope). On failure, stdout SHALL be empty unless a command explicitly documents otherwise (none expected).

## Essential Logic

**deriveStdoutPayload(mode, result):**

- When `mode = json`: `{ success: true, data: result.data }` including `next_commands` inside `data` when provided
- When `mode = toon`: encode the full `result.data` object via `@toon-format/toon` (single-row acks use `name[1]{fields}:` like multi-row lists — acceptable overhead for one parser)
- Commands SHALL NOT branch on row count or command name to pick a format

**deriveStderrError(mode, error):**

- When `mode = json`: `{ success: false, error: { code, message, suggestion? } }` on stderr
- When `mode = default`: `{CODE}: {message}` on stderr; optional second line `hint: {suggestion}` — **not TOON** (errors are rare, small, and text parses fine)

**suggestCommand(unknown, candidates):** pure string distance → optional “Did you mean …?”

**conciseHelp vs fullHelp(command):** two static help specs per command group

**exitCodeFor(error_code):** pure mapping (e.g. `AUTH_REQUIRED` → 2)

## Accidental State and Control

- Cache help text templates in memory (optional, correctness unchanged if omitted)
- TOON encoder reuse via existing `formatToon` / `toonList` helpers

## Feeders / Observers

**Feeders:** `process.argv`, env (`PROBE_*`), config files — unchanged; no new stdin prompt feeder.

**Observers:**

- stdout: TOON or JSON only on success
- stderr: structured errors; daemon `--pretty` logs unchanged
- process exit: mapped code

## Decisions

| Decision | Essential / Accidental | Rationale |
|----------|------------------------|-----------|
| Remove clack entirely | Accidental | Not part of agent contract; simplifies output |
| Never prompt | Essential policy | Agents cannot answer prompts reliably; TTY is unreliable |
| Unified `emit()` | Essential | Fixes `success()` no-op; one code path |
| **Policy A: TOON on all success** | Essential | One parser for agents; no per-command format table; small acks may use `foo[1]{…}:` |
| Keep TOON default | Essential | Token efficiency on lists/queries; uniform encoding on mutations is acceptable |
| **Text errors (not TOON)** | Essential | `{CODE}: msg` + `hint:` on stderr; includes `code` in default mode (today only message) |
| `--json` stable contract | Essential | Tools that require JSON keep envelope shape |
| Drop `--plain`, NO_COLOR, `-q`, `--no-input` | N/A | User simplification; never-prompt + emit suffice |
| `wallet delete` requires `--yes` | Essential | Replaces confirm prompt |
| `llms.txt` at `docs/llms.txt` | Accidental | Discovery; mirrors clig.dev pattern |
| Exit code map (small set) | Essential | Script branching without parsing stderr |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **BREAKING** humans who relied on interactive `probe auth` | Document `--password-file`; error message names exact flag |
| Large handler migration misses a `console.log` | Grep for `console.log`, `@clack`, `log.` in CI; update spec scenarios |
| `onboard` / `upgrade` still import clack | Include in removal checklist |
| Daemon `--pretty` inconsistent with “stderr errors only” | Document exception: lifecycle logs are not command data |
| Exit code collisions with shell conventions | Document table; keep 1 as generic failure |

## Resolved decisions

| Topic | Decision |
|-------|----------|
| Success format | **Policy A** — always TOON (default) or JSON (`--json`); no per-command exceptions |
| Error format (default) | Plain text on stderr: `{CODE}: {message}` and optional `hint: {suggestion}` — not TOON |
| `emit` naming | Implementer choice (`emit` / extend `success()`); one export used by all commands |
| `next_commands` / “Next steps” | Fold into `data` + TOON/`--json`; remove ad hoc stdout plain-text blocks (e.g. after `task claim`) |
