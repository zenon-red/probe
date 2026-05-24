## ADDED Requirements

### Requirement: Post-upgrade skills compatibility check

After `probe upgrade` completes a successful in-place upgrade (`updated: true`), the command SHALL read the global Skills CLI lock file and compare every installed `zenon-red/skills` entry’s `ref` to the probe-bundled expected ref.

The check SHALL NOT run when `--check` is used, when no upgrade was performed (`updated: false`), or when upgrade failed.

The check SHALL be warn-only: it MUST NOT change exit codes or block the upgrade.

Lock file resolution SHALL match Skills CLI behavior:

1. `$XDG_STATE_HOME/skills/.skill-lock.json` when `XDG_STATE_HOME` is set
2. Otherwise `~/.agents/.skill-lock.json`

The lock file `skills` field SHALL be interpreted as a map of entries. Matching entries are those whose `source` equals exactly `zenon-red/skills`. A global `zenon-red/skills --skill='*'` install produces multiple matching rows (one per skill name); the check SHALL consider all of them.

Compatibility status SHALL be determined as follows:

- `ok` — at least one matching entry and every matching entry has `ref` equal to the probe expected ref
- `warn` — at least one matching entry and any of: missing `ref`, `ref` not equal to expected, or inconsistent `ref` values across matching entries
- `unknown` — lock file missing or unreadable, invalid JSON, no `skills` map, or zero matching entries

#### Scenario: Skills ref matches after upgrade

- **GIVEN** a successful `probe upgrade --yes`
- **AND** the global lock file contains one or more entries with `source = "zenon-red/skills"`
- **AND** every such entry has `ref` equal to the probe expected ref
- **WHEN** the upgrade command finishes
- **THEN** the result SHALL include `skillsCompat.status = "ok"`
- **AND** `skillsCompat.expectedRef` SHALL equal the probe expected ref

#### Scenario: Skills ref mismatch after upgrade

- **GIVEN** a successful `probe upgrade --yes`
- **AND** the global lock file contains a `zenon-red/skills` entry whose `ref` differs from the probe expected ref
- **WHEN** the upgrade command finishes
- **THEN** the result SHALL include `skillsCompat.status = "warn"`
- **AND** `skillsCompat.foundRef` SHALL report an offending ref value
- **AND** `skillsCompat.fixCommand` SHALL be `npx skills add zenon-red/skills#<expectedRef> --skill='*' -y -g`

#### Scenario: Lock entry without ref

- **GIVEN** a successful `probe upgrade --yes`
- **AND** the global lock file contains a `zenon-red/skills` entry with no `ref` field (e.g. manual unpinned install)
- **WHEN** the upgrade command finishes
- **THEN** the result SHALL include `skillsCompat.status = "warn"`
- **AND** `skillsCompat.fixCommand` SHALL equal the probe pinned install command

#### Scenario: Multiple zenon-red skills rows must all match

- **GIVEN** a successful `probe upgrade --yes`
- **AND** the lock file contains `zr-vote` and `zr-execute` both with `source = "zenon-red/skills"`
- **AND** `zr-vote` has the expected ref but `zr-execute` has a different ref
- **WHEN** the upgrade command finishes
- **THEN** the result SHALL include `skillsCompat.status = "warn"`

#### Scenario: Skills lock missing after upgrade

- **GIVEN** a successful `probe upgrade --yes`
- **AND** no readable global lock file exists, or no entry has `source = "zenon-red/skills"`
- **WHEN** the upgrade command finishes
- **THEN** the result SHALL include `skillsCompat.status = "unknown"`
- **AND** `skillsCompat.fixCommand` SHALL include the pinned install command for the expected ref

#### Scenario: Check-only upgrade skips skills check

- **GIVEN** `probe upgrade --check` runs successfully
- **WHEN** the command completes
- **THEN** the result SHALL NOT include `skillsCompat`

### Requirement: Skills compatibility human output

When `probe upgrade` runs without `--json` and `skillsCompat` is present, human-readable compatibility lines SHALL be written to stderr only.

- `status = "ok"` MAY print a single confirmation line including the expected ref
- `status = "warn"` or `unknown` SHALL print a warning line and the `fixCommand` on stderr

Stdout on success SHALL remain the normal TOON upgrade payload only.

#### Scenario: Mismatch warning on stderr

- **GIVEN** a successful upgrade without `--json`
- **AND** `skillsCompat.status = "warn"`
- **WHEN** the command completes
- **THEN** stderr SHALL contain the warning message and fix command
- **AND** stdout SHALL contain only the structured upgrade success payload

### Requirement: Skills compatibility JSON output

When `probe upgrade --json` completes a successful upgrade with a skills check, the JSON success envelope on stdout SHALL include `data.skillsCompat` with fields: `status`, `expectedRef`, optional `foundRef`, `message`, and optional `fixCommand`.

The command SHALL NOT print human warning text for skills compatibility when `--json` is set.

#### Scenario: JSON includes skillsCompat

- **GIVEN** `probe upgrade --yes --json` succeeds with skills check enabled
- **WHEN** the command completes
- **THEN** stdout SHALL contain `{ "success": true, "data": { ..., "skillsCompat": { ... } } }`
- **AND** stderr SHALL not contain skills-specific warning prose beyond structured errors

### Requirement: Skills ref release reminder script

Probe SHALL provide `npm run check:skills-ref` for maintainers. The script SHALL read `EXPECTED_SKILLS_REF` from `src/utils/skills-check.ts` and compare it to the latest `v*` git tag on `zenon-red/skills`.

Default (warn) mode SHALL exit `0` and print a stderr reminder when the latest skills tag differs from `EXPECTED_SKILLS_REF`.

Strict mode (`--strict`) SHALL exit non-zero on mismatch for use in release automation.

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

#### Scenario: Refs match

- **GIVEN** `EXPECTED_SKILLS_REF` equals the latest `zenon-red/skills` `v*` tag
- **WHEN** `npm run check:skills-ref` runs in warn or strict mode
- **THEN** the command SHALL exit `0`
- **AND** stderr SHALL not print a mismatch warning
