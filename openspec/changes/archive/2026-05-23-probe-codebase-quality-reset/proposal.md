## Why

Probe works as a compact Nexus CLI, but structural debt has accumulated in the places where agent-facing correctness matters most: schema decoding can silently mislabel query output, `--host` and `--module` flags are declared but often ignored, command handlers use untestable mega-switches and deep `process.exit` calls, and the daemon bundles too many responsibilities into one file. A focused quality reset is needed now so schema drift is harder to ship, connection overrides behave consistently, and high-risk behavior can be tested in isolation.

## What Changes

- **New**: Schema decoder drift detection — unit test fails when generated enum decoders disagree with `module_bindings/types.ts`; `generate:decoders` wired into build/CI enforcement
- **New**: `commandContextOptions()` helper — canonical forwarding of `wallet`, `host`, and `module` to `CommandContext.create` / `withAuth`
- **New**: `ProbeError` typed error boundary — handlers throw; render and exit only at CLI entry (`src/index.ts`)
- **New**: `MessageTarget` model — shared project/channel resolution for message list/send/directive flows
- **New**: Explicit citty subcommands for all nexus domain commands plus `config` and `token`; top-level `probe login` plus `probe auth status` — removes positional `action` / overloaded positional patterns
- **BREAKING**: No backward compatibility for old positional action dispatch; update docs/skills in the same change
- **New**: Small `runReducerCommand` helper — removes repeated authenticated reducer try/catch without hiding validation
- **New**: Daemon module split — `src/daemon/{events,harness-runner,session,action-executor,loop}.ts`; thin `nexus-daemon.ts` CLI wrapper
- **New**: Expanded unit tests — drift detection, host/module propagation, message targets, harness outcomes, reconnect/backoff, typed error rendering, SQL decode edge cases, action ownership
- **Modified**: `CommandContext` — typed table getters from STDB bindings; remove public `iter<T>()` and ad-hoc `db` casts at migrated call sites
- **Modified**: `probe query` decode policy — decode only when table inference is unambiguous; otherwise raw output with metadata (no silent misdecode)
- **Modified**: `test:ci` — runs full high-risk unit suite; runs `generate:decoders` before tests (generated output is gitignored)
- **BREAKING**: Positional `action` argument removed from message, task, agent, project, idea, discover — subcommands only
- **Non-breaking (behavior)**: Command output semantics preserved except where currently broken (host/module overrides, stale enum decode)

## Breaking CLI Changes

All six nexus command groups move to citty subcommands. Positional `action` args and shared mega-arg interfaces are removed. No alias or compatibility shims — heavy dev; docs and skills updated in the same change.

| Command | Subcommands |
|---------|-------------|
| `message` | `list`, `directives`, `send`, `directive`, `channels` |
| `task` | `list`, `ready`, `get`, `create`, `claim`, `update`, `review`, `deps`, `watch` |
| `agent` | `register`, `status`, `set-status`, `capabilities`, `me`, `bio`, `heartbeat`, `list`, `identity`, `voice` |
| `project` | `list`, `get`, `status`, `create`, `set-status` |
| `idea` | `list`, `pending`, `get`, `dimensions`, `propose`, `vote` |
| `discover` | `report`, `review`, `list`, `get` |
| `config` | `get`, `set`, `list` |
| `token` | `show`, `clear` |

**Top-level (no parent subcommand group):** `login <wallet>` (OIDC authenticate and cache token)

**Auth inspection:** `probe auth status` (only subcommand under `auth`)

**Already subcommands (verify only, no conversion):** `action`, `wallet`, `cooldown`

**Single-purpose (no subcommand conversion):** `query`, `doctor`, `whoami`, `onboard`, `upgrade`, `sign`, `nexus`

## Capabilities

### New Capabilities

- `schema-decoding`: Generated SQL decoders stay in sync with SpacetimeDB bindings; drift fails CI
- `connection-target`: Every command declaring `--host` or `--module` forwards overrides to the connection layer
- `error-boundary`: Typed `ProbeError`; process exit only at CLI boundary
- `sql-query-decode`: Safe decode policy for `probe query` — no guessed decoding on ambiguous SQL

### Modified Capabilities

- `probe`: All nexus groups plus config/token converted to citty subcommands; `probe login` + `probe auth status` (breaking); action/wallet/cooldown already subcommands; shared message target resolution; daemon split; reducer wrapper; CommandContext cleanup; expanded tests

## Impact

**Probe CLI (`src/`):**
- New: `src/daemon/*.ts`, drift test, `commandContextOptions`, `ProbeError`, message target module, reducer wrapper
- Modified: `src/commands/nexus/*.ts`, `src/commands/nexus-daemon.ts`, `src/utils/context.ts`, `src/utils/output.ts`, `src/index.ts`, `src/commands/query.ts`, `scripts/generate-decoders.ts`, `package.json` (build/test scripts)
- Tests: new files under `tests/unit/`; expanded `test:ci`

**Documentation (required, same change):**
- Rewrite `docs/commands.md`, `skills/probe/SKILL.md`, `skills/probe/references/commands.md` for subcommand-only CLI
- Update help text for SQL decode limitations and message target prefixes

**No external dependency changes.** No SpacetimeDB schema or reducer changes required.
