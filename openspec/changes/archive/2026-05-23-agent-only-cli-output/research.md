## Codebase Exploration

Probe today has **three non-JSON output channels** (documented in `openspec/specs/probe.md` § Output Modes):

1. **TOON** — explicit `console.log(toonList(...))` in command handlers (`src/utils/toon.ts`, `@toon-format/toon`).
2. **Clack UI** — `@clack/prompts` in `src/utils/output.ts` (spinners, `log.*`, `note`) and interactive flows in `src/utils/credentials.ts`, `src/commands/wallet/delete.ts`, `src/commands/onboard.ts`, `src/commands/upgrade.ts`.
3. **Plain text** — ad hoc `console.log` for “Next steps” and similar.

`success()` in `src/utils/output.ts` prints JSON envelopes in `--json` mode but is a **no-op** in default mode; handlers must remember to log TOON separately. Errors use structured `error(code, message, suggestion?)` with JSON on stderr in JSON mode and clack `log.error` otherwise.

Help is custom via `src/utils/help.ts` (`printHelp`, `normalizeHelpArgv`). `probe action show` already emits `context_commands` in JSON mode and a TOON `context_commands` table in default mode — a good pattern to generalize.

Clack usage is limited to ~6 files; most read-only Nexus commands already emit TOON-only stdout.

Compared against [CLI Guidelines](https://clig.dev) (cloned to `~/research/cli-guidelines`): probe intentionally deviates on **default format** (TOON over human tables). Gaps relevant to agents: stdout purity, no interactive prompts, discoverability (typos, next commands), stable script contract via `--json`.

**Classification for this change:**

| Data | Class |
|------|--------|
| Command results (tasks, actions, etc.) | Essential — must appear on stdout |
| `{ success, data, error }` envelope | Essential derived — canonical JSON shape |
| Spinner/progress UI | Accidental — removable without changing correctness |
| TTY-detected prompts | Accidental control — replaced by never-prompt policy |
| Clack log styling | Accidental — removable |

## Sources

- `openspec/specs/probe.md` — output modes, password resolution, action CLI
- `src/utils/output.ts`, `src/utils/credentials.ts`, `src/utils/help.ts`
- [CLI Guidelines](https://clig.dev) — composability, stdout/stderr, help, errors (human-first defaults explicitly not adopted)
- `@clack/prompts` — used only for UX; not required for core behavior when flags/files supplied

## Approach A: Unified emit module

Introduce `emitResult({ data, message?, next_commands? })` used by all commands. Default: encode `data` as TOON on stdout. `--json`: envelope on stdout. Remove clack; stderr only for `error()`. Never prompt — `resolvePasswordInput` / `resolveMnemonicInput` require file/env/flags or fail with structured errors.

**Feasibility:** High. Touches `output.ts` and each command handler (mechanical migration). Aligns with existing JSON envelope and TOON helpers.

## Approach B: JSON-only agent mode

Make `--json` the de facto agent contract; leave default mode as-is for occasional human use.

**Feasibility:** Medium. Smaller code change but perpetuates dual behavior and stdout pollution in default mode. Agents must remember `--json` everywhere; TOON default becomes misleading.

## Approach C: New `probe agent-output` subcommand layer

Wrap existing commands behind a machine-only facade.

**Feasibility:** Low. Duplicates command surface, breaks existing skills/docs, high maintenance.

## Recommended Approach

**Approach A** — unified emit, never prompt, remove clack. Keeps TOON as default (token-efficient for agents) and `--json` as the strict stable contract. One output path eliminates the `success()` no-op footgun.

**Output policy A (refined):** encode **all** success `data` as TOON (default) or JSON — no per-command format matrix. Single-row acks may use `foo[1]{fields}:`; that overhead is acceptable for one agent parser. Errors stay plain text on stderr (`CODE:` + `hint:`), not TOON.

## Trade-offs

| Topic | Recommended (A) | B (JSON-only) | C (wrapper) |
|-------|-------------------|---------------|-------------|
| Agent stdout purity | Strong | Strong only with `--json` | Strong but redundant API |
| Migration cost | Medium (handler sweep) | Low | High |
| Human local use | Requires flags for secrets | Same | Worse DX |
| TOON default | Preserved | De-emphasized | Unchanged |

**Dropped from clig.dev (explicit non-goals):** `--plain`, `NO_COLOR` / `--no-color`, `--no-input`, `--quiet`, man pages, pager, XDG migration, analytics, emoji decorations. **Never-prompt** replaces TTY heuristics and `--no-input`.

**Rejected (output optimization):** per-command TOON vs plain-text matrix; TOON on stderr for errors. **Adopted:** policy A — TOON on all success stdout, text errors on stderr.

**Edge cases:** `probe nexus` daemon uses `--pretty` for stderr lifecycle logs — keep as optional human-oriented daemon mode, not general command output. `wallet delete` moves to `--yes` only (no confirm prompt). Breaking for anyone relying on interactive password prompts without files.
