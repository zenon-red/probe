## Why

Probe and the global `zenon-red/skills` install are upgraded independently. After `probe upgrade`, operators need a signal when the global skills tag does not match the tag this probe release was tested against.

## What Changes

- Add `EXPECTED_SKILLS_SOURCE` and `EXPECTED_SKILLS_REF` (one constant pair, shared by install and check).
- **Onboard and verify** install with a pinned tag: `npx skills add zenon-red/skills#<ref> --skill='*' -y -g`.
- Add `checkSkillsCompat()` — read global lock, compare **all** `zenon-red/skills` rows’ `ref` to the expected tag.
- After **successful** `probe upgrade`, attach `skillsCompat` to output (stderr hints in human mode; `data.skillsCompat` with `--json`).
- Warn-only: no exit code change, no blocking.
- Add **`npm run check:skills-ref`** for maintainers: compare `EXPECTED_SKILLS_REF` to the latest `v*` tag on `zenon-red/skills`; warn on `check:push`, **fail** in `release-binaries` workflow before publish.

**Fix command (same as onboard):**

`npx skills add zenon-red/skills#<expectedRef> --skill='*' -y -g`

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `probe-cli`: Post-upgrade skills compatibility check and structured output.
- `probe-onboarding`: Pinned global skills install using the same expected ref constant.

## Impact

- **Code:** `src/utils/skills-check.ts` (new), `src/utils/skills-install.ts`, `src/commands/upgrade.ts`, `scripts/check-skills-ref.ts`, tests
- **CI:** `release-binaries.yml` runs `check:skills-ref` before publish; `package.json` adds `check:skills-ref` and wires warn into `check:push`
- **Docs:** `docs/commands.md` (upgrade + onboard + release bump note)
