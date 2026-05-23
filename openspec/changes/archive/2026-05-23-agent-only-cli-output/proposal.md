## Why

Probe is used **exclusively by agents**. Today stdout mixes TOON, clack spinners, and ad hoc plain text; `success()` is a no-op outside `--json`; and TTY-gated prompts are a poor signal (agents often run in real terminals). This makes output hard to parse reliably and violates composable CLI principles without benefiting our users.

Aligning with agent-first CLI design (informed by [clig.dev](https://clig.dev), adapted for TOON-first output) gives agents a single rule: **stdout = TOON data (or `--json`), stderr = text errors, never prompt**.

**Output policy A:** all successful commands use the same encoding — no per-command “TOON vs plain text” matrix. Mutations (`action complete`, `wallet delete`) emit TOON like `task list`; agents parse stdout one way. Errors are plain text on stderr (`CODE: message`, `hint:`), not TOON.

## What Changes

- **BREAKING**: No interactive prompts — password, mnemonic, and confirm dialogs removed. Required input MUST come from flags, `--password-file` / `--mnemonic-file`, env vars, or `--yes` (destructive ops).
- **BREAKING**: `@clack/prompts` removed from command paths — no spinners, `log.success`, `note`, or clack password/text UI on stdout/stderr.
- **New**: Unified `emit` — all commands pass `data`; default mode always writes TOON to stdout; `--json` writes the envelope. No per-command format selection.
- **Modified**: `success()` behavior — folded into `emit`; no no-op in default mode.
- **Modified**: stderr reserved for errors as **text** (`{CODE}: {message}`, optional `hint:`) or JSON error envelope with `--json` — not TOON.
- **BREAKING**: Remove ad hoc plain-text stdout (e.g. `auth` Wallet/Expires lines, `task claim` “Next steps”) — fold into `data` / `next_commands` and emit as TOON or JSON.
- **New**: `next_commands` field generalized beyond `action show` — TOON tables and JSON `data.next_commands` where workflows have obvious follow-ups.
- **New**: Typo suggestions for unknown top-level commands (and common subcommand names).
- **New**: Concise vs full help — bare `probe` shows short help; `probe --help` shows full panel.
- **New**: Doc URL footer in help text → `docs/commands.md`.
- **New**: `llms.txt` (or `probe` doc target) — agent cheat sheet for commands, output modes, error codes.
- **New**: Distinct exit codes for common failure classes (auth, connection, validation, not found) — documented in skill and docs.
- **Removed dependency**: `@clack/prompts` (if no remaining consumers after migration).

### Explicitly out of scope (dropped from earlier clig.dev review)

- `--plain` tabular output
- `NO_COLOR` / `--no-color` / TTY color policy
- `--no-input` and `--quiet` (replaced by never-prompt + stdout purity)
- Man pages, pager integration, XDG config migration
- Analytics / phone-home
- Emoji or decorative terminal UI

### Unchanged intentional deviations

- **TOON default on every success** (not human tables, not mixed plain-text acks) — one parser for agents
- **`--json`** for strict structured envelope when tools require JSON
- Long-form flags only (no short-flag pollution) — keep as-is

### Explicitly rejected (output)

- Per-command TOON vs plain-text rules — extra complexity for negligible token savings on single-row acks
- TOON-encoded errors on stderr

## Capabilities

### New Capabilities

_(none — behavior deltas merge into main `probe` spec)_

### Modified Capabilities

- `probe`: Output contract (unified emit, stdout/stderr discipline), interaction policy (never prompt), help (concise/full, typos, doc links), discoverability (`next_commands`, `llms.txt`), exit code map; remove clack/TTY prompt requirements from password/onboard/delete flows.

## Impact

**Probe CLI:**

- `src/utils/output.ts` — rewrite around unified emit; remove clack
- `src/utils/credentials.ts` — never prompt; fail with flag hints
- `src/utils/help.ts` — concise help, typo helper, doc footer
- `src/commands/**/*.ts` — migrate handlers off scattered `console.log` / clack
- `src/commands/wallet/delete.ts` — `--yes` required for delete without prompt
- `package.json` — remove `@clack/prompts` if unused
- `openspec/specs/probe.md` — output modes section rewrite (on archive/sync)
- `README.md` — light syntax refresh (never-prompt flags, `--json`, link to `docs/llms.txt`)
- `docs/commands.md`, `skills/probe/SKILL.md`, `skills/probe/references/commands.md` — agent-only contract, dropped flags, exit codes, `llms.txt`
- New: `llms.txt` at repo root or `docs/llms.txt`

**No SpacetimeDB / Nexus / cross-repo changes.**
