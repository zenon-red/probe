## Context

Zenon-red agents install skills globally via the Skills CLI. A `zenon-red/skills --skill='*'` install creates **one lock row per skill name**, each sharing `source` and `ref`.

Probe will use one expected tag constant for both onboard install and post-upgrade verification.

## Goals / Non-Goals

**Goals:**

- Single `EXPECTED_SKILLS_REF` used by `skills-install.ts` and `checkSkillsCompat()`.
- Pinned global install on onboard (`#<EXPECTED_SKILLS_REF>`).
- After successful `probe upgrade`, report `ok` | `warn` | `unknown` with `fixCommand`.
- Probe-cli output policy: TOON/JSON on stdout; compat hints on stderr when not `--json`.
- Maintainer reminder: `npm run check:skills-ref` compares probe constant to latest `zenon-red/skills` git tag.

**Non-Goals:**

- Enforcement or non-zero exit codes
- `skillFolderHash` checks (use `npx skills update -g` for same-tag content refresh)
- New lock formats, STDB/Nexus reporting, `probe doctor` integration
- Project-local lock files
- Subprocess `skills list` (read lock JSON only)
- Auto-bumping `EXPECTED_SKILLS_REF` (script reminds only)
- Skills-repo hooks (reminder lives in probe release path)

## Cross-repo Scope

Bump `EXPECTED_SKILLS_REF` per probe release to a real `zenon-red/skills` git tag (e.g. `v0.3.3`).

## Decisions

### 1. Shared constants (`src/utils/skills-check.ts`)

```ts
export const EXPECTED_SKILLS_SOURCE = "zenon-red/skills";
export const EXPECTED_SKILLS_REF = "v0.3.3"; // bump per probe release
export const SKILLS_INSTALL_CMD = `npx skills add ${EXPECTED_SKILLS_SOURCE}#${EXPECTED_SKILLS_REF} --skill='*' -y -g`;
```

`skills-install.ts` imports and runs `SKILLS_INSTALL_CMD` (or equivalent) for install and recovery text.

### 2. Lock file path

Mirror Skills CLI `getSkillLockPath()`:

1. `$XDG_STATE_HOME/skills/.skill-lock.json` when set
2. Else `~/.agents/.skill-lock.json`

### 3. Lock parsing and matching

- `skills` is `Record<string, SkillLockEntry>`.
- Collect entries where `source === EXPECTED_SKILLS_SOURCE`.
- Zero matches, missing file, or invalid JSON → `unknown`.
- Any missing `ref`, any `ref` ≠ expected, or inconsistent refs across rows → `warn`.
- All rows match expected `ref` → `ok`.

### 4. When to run the check

| `probe upgrade` outcome | Run check? |
|-----------------------|------------|
| `updated: true` | Yes |
| `--check` only | No |
| `updated: false` | No |
| Upgrade failed | No |

### 5. Output

- `upgradeResult()` includes optional `skillsCompat`.
- JSON: `data.skillsCompat` only.
- Human: stderr ok/warn/unknown + `fixCommand` when not `ok`.

### 6. Moving forward (steady state)

| Event | Behavior |
|-------|----------|
| `probe onboard` | Installs `zenon-red/skills#<EXPECTED_SKILLS_REF>` globally; lock rows carry that `ref` |
| `probe upgrade` (success) | Warns if lock ref ≠ probe’s `EXPECTED_SKILLS_REF` |
| New probe release | Bump `EXPECTED_SKILLS_REF` in probe; operator re-runs onboard install command or `fixCommand` after upgrade |
| Same tag, content changed on GitHub | `npx skills update -g` (Skills CLI); not probe’s job |

`warn` for missing `ref` covers manual installs without `#tag`, not a supported probe path.

### 7. Release reminder script (`scripts/check-skills-ref.ts`)

Reads `EXPECTED_SKILLS_REF` from `src/utils/skills-check.ts` (same source of truth as runtime — no duplicate constant).

Fetches latest semver git tag on `zenon-red/skills` via `gh api repos/zenon-red/skills/tags` (fallback: `git ls-remote --tags` if `gh` unavailable).

| Mode | Flag / invocation | Exit code |
|------|-------------------|-----------|
| Warn | `npm run check:skills-ref` (default) | `0` always; prints warning to stderr when `latestTag !== EXPECTED_SKILLS_REF` |
| Strict | `npm run check:skills-ref -- --strict` | `1` on mismatch (for CI) |

**Wiring:**

- `package.json`: `"check:skills-ref": "npx tsx scripts/check-skills-ref.ts"`
- `check:push`: append `npm run check:skills-ref` after existing checks (warn-only)
- `.github/workflows/release-binaries.yml`: run `npm run check:skills-ref -- --strict` before release publish step

Mismatch message (example):

```text
skills-ref: probe expects v0.3.3, zenon-red/skills latest tag is v0.3.4
  → bump EXPECTED_SKILLS_REF in src/utils/skills-check.ts if this release needs it
```

Intentional skills-ahead-of-probe is allowed only by bumping the constant or skipping/failing release consciously — not by env override.

### 8. Testing

Fixtures: `ok` (multi-row, same ref), `warn-mismatch`, `warn-missing-ref`, `warn-mixed-refs`, `unknown`.

Unit tests for `check-skills-ref` mock tag list (no network in CI).

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Probe/skills tag skew at release | `check:skills-ref --strict` in release workflow |
| Lock schema drift | Defensive parse → `unknown` |
| `gh` missing locally | Warn script falls back to `git ls-remote` or skips with clear message |
