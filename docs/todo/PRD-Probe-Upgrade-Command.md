# PRD: `probe upgrade` (Runtime-Agnostic, Agent-Safe)

## Overview

Add a new top-level command, `probe upgrade`, that updates Probe safely across supported installation methods without assuming Bun is installed.

This command must work for:
- npm global installs (`@zenon-red/probe`)
- standalone binary installs from GitHub Releases

It must be deterministic and automation-friendly for agent workflows (non-interactive by default, machine-readable mode, strict exit codes).

## Problem Statement

Probe is distributed via both npm and standalone binaries. Existing upgrade guidance is manual and inconsistent across environments. Agents need a single command that can:

1. detect install method,
2. check for updates,
3. perform upgrade safely,
4. avoid Bun/runtime assumptions.

## Goals

1. Introduce `probe upgrade` command with method auto-detection.
2. Support upgrade check-only mode.
3. Support explicit version targeting.
4. Provide stable JSON output for agents.
5. Add checksum verification + rollback safety for binary upgrades.

## Non-Goals

- Auto-upgrade on startup (deferred).
- Package-manager-specific support beyond npm for MVP (brew/choco/scoop deferred).
- Channel management (beta/canary) for MVP.

## Scope

### In scope

- New command: `probe upgrade [targetVersion]`
- Flags:
  - `--check`
  - `--json`
  - `--yes`
  - `--method <auto|npm|binary>`
- Install-method detection (`npm`, `binary`, `unknown`)
- npm upgrade path (`npm install -g @zenon-red/probe@<version-or-latest>`)
- binary upgrade path (GitHub release asset download, checksum verification, atomic replace, rollback)
- docs updates for command reference

### Out of scope

- interactive TUI wizard
- policy-driven auto updates
- semver range constraints

## User Experience

## Command

```bash
probe upgrade
probe upgrade --check
probe upgrade 1.2.0
probe upgrade --method npm
probe upgrade --method binary --yes
probe upgrade --json --check
```

## Behavior

### Default (`probe upgrade`)

1. detect method (`auto` unless overridden)
2. resolve current version + latest version
3. if up-to-date: print success/no-op
4. else perform method-specific upgrade
5. run post-upgrade version verification

### Check mode (`--check`)

- never modifies installation
- reports `currentVersion`, `latestVersion`, `updateAvailable`, `method`

### Target version

- accepts `1.2.0` or `v1.2.0` input
- normalized to semver string without `v`

## Output Contract

### Human mode

- concise progress lines during execution (`checking`, `downloading`, `verifying`, `replacing`)
- final structured TOON payload for consistency with Probe command conventions
- clear next-step guidance on failure

Required final TOON key and fields:

- key: `upgrade_result`
- fields:
  - `method`
  - `currentVersion`
  - `targetVersion`
  - `latestVersion` (when check-only or no target provided)
  - `updated`
  - `checkOnly`

### JSON mode (`--json`)

Success shape:

```json
{
  "ok": true,
  "method": "npm",
  "currentVersion": "1.1.0",
  "targetVersion": "1.2.0",
  "updated": true,
  "checkOnly": false
}
```

No update shape:

```json
{
  "ok": true,
  "method": "binary",
  "currentVersion": "1.2.0",
  "latestVersion": "1.2.0",
  "updated": false,
  "checkOnly": true
}
```

Failure shape:

```json
{
  "ok": false,
  "code": "UPGRADE_FAILED",
  "message": "Checksum mismatch for downloaded binary",
  "method": "binary"
}
```

## Exit Codes

- `0`: success (including no update available)
- `1`: any failure

## Installation Method Detection

Priority order:

1. explicit `--method` if provided
2. npm detection:
   - executable path hints and/or
   - `npm list -g @zenon-red/probe --depth=0` when npm exists
3. binary detection:
   - executable path points to standalone binary layout
4. fallback: `unknown`

If `unknown`, command must fail with actionable manual instructions.

## Method Implementations

## 1) npm path

- version source: npm registry metadata for `@zenon-red/probe`
- command execution:
  - latest: `npm install -g @zenon-red/probe@latest`
  - target: `npm install -g @zenon-red/probe@<target>`
- post-check: `probe --version`

## 2) binary path

- version source: GitHub Releases for `zenon-red/probe`
- platform asset resolution by `os` + `arch`
- download:
  - target binary asset
  - `SHA256SUMS.txt`
- validate checksum before replace
- replacement strategy:
  1. write temp file in same dir
  2. chmod executable
  3. backup current binary (`.bak`)
  4. atomic rename temp -> active
  5. verify `--version`
  6. on failure, rollback from backup

## Security and Reliability Requirements

1. Never replace executable before checksum passes.
2. Always keep restorable backup during replacement.
3. Fail fast on network, permissions, or mismatch issues.
4. Avoid shell injection risks (no unsanitized interpolation).
5. Timeouts for network and subprocess calls.

## Technical Design

## Files

- `src/commands/upgrade.ts` (new command)
- `src/utils/upgrade.ts` (detection, registry/release checks, method execution)
- `src/index.ts` (wire subcommand + top-level help)
- `docs/commands.md` (docs)
- `skills/probe/references/commands.md` (mirror)

## Command framework and utilities

- Implement as a standard top-level `citty` command (`defineCommand`) to match existing Probe commands.
- Use existing output helpers from `src/utils/output.ts`:
  - `setJsonMode` for `--json`
  - `success` for JSON success payloads
  - `error` for terminal failures and exit code handling
- Use `toonList` from `src/utils/toon.ts` for final non-JSON structured output.
- Use `printHelp` from `src/utils/help.ts` for command help text and examples.

## Runtime constraints

- Implementation must not depend on Bun runtime APIs.
- Use Node built-ins (`child_process`, `fs`, `os`, `path`, `stream`, `crypto`, `https/fetch`).

## Error Model

Standardized error codes:

- `METHOD_UNKNOWN`
- `METHOD_UNAVAILABLE`
- `VERSION_LOOKUP_FAILED`
- `UPGRADE_FAILED`
- `CHECKSUM_MISMATCH`
- `PERMISSION_DENIED`
- `ROLLBACK_FAILED`

## Test Plan

### Unit tests

1. version normalization (`v1.2.0` -> `1.2.0`)
2. method detection precedence
3. checksum parser + validator
4. unknown method error shape
5. JSON output contract stability

### Integration tests (mocked IO)

1. npm check-only reports update available
2. npm upgrade command invocation args are correct
3. binary download + checksum success path
4. checksum mismatch fails before replacement
5. replacement failure triggers rollback

### Manual checks

1. npm-installed probe upgrades successfully
2. binary-installed probe upgrades successfully
3. non-writable install path returns permission guidance
4. `--check` does not mutate installation

## Documentation Updates (Required)

1. `docs/commands.md`
   - add `probe upgrade` syntax and flags
2. `skills/probe/references/commands.md`
   - mirror command section
3. `README.md` (optional)
   - short upgrade snippet if command examples are listed

## Success Criteria

1. `probe upgrade` works for npm and standalone binary users.
2. No Bun dependency required for upgrade flow.
3. Binary upgrades verify checksum and support rollback.
4. JSON output is stable for agents.
5. Failure messages are actionable.

## Future Work

- add package-manager integrations (`brew`, `choco`, `scoop`, `pnpm`, `bun`) as explicit methods
- add signed-release verification beyond checksum
- add optional notify/auto-update policy controls
