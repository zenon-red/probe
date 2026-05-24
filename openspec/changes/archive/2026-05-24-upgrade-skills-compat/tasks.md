## 1. Shared skills constants and check

- [x] 1.1 Add `src/utils/skills-check.ts` with `EXPECTED_SKILLS_SOURCE`, `EXPECTED_SKILLS_REF`, `SKILLS_INSTALL_CMD`, `SkillsCompat`, `getSkillLockPath()`, `checkSkillsCompat()`
- [x] 1.2 Parse lock `skills` map; collect all `source === EXPECTED_SKILLS_SOURCE`; apply ok/warn/unknown rules
- [x] 1.3 Add `tests/fixtures/skills-lock/` and `tests/unit/skills-check.test.ts`

## 2. Pinned onboard install

- [x] 2.1 Update `src/utils/skills-install.ts` to use `SKILLS_INSTALL_CMD` for install and recovery strings
- [x] 2.2 Unit test or smoke that install command includes `#${EXPECTED_SKILLS_REF}`

## 3. Upgrade integration

- [x] 3.1 Extend `upgradeResult()` with optional `skillsCompat`
- [x] 3.2 Run `checkSkillsCompat()` after `updated: true`; stderr hints in human mode
- [x] 3.3 Add `tests/unit/upgrade-skills-compat.test.ts`

## 4. Release reminder (`check:skills-ref`)

- [x] 4.1 Add `scripts/check-skills-ref.ts` — read `EXPECTED_SKILLS_REF` from `skills-check.ts`, fetch latest `v*` tag on `zenon-red/skills`, compare
- [x] 4.2 Support `--strict` (exit 1 on mismatch) vs default warn-only (exit 0, stderr message)
- [x] 4.3 Add `check:skills-ref` to `package.json`; append warn-only run to `check:push`
- [x] 4.4 Run `npm run check:skills-ref -- --strict` in `.github/workflows/release-binaries.yml` before publish
- [x] 4.5 Unit tests with mocked tag list (no live GitHub in CI)

## 5. Documentation

- [x] 5.1 Document pinned onboard + post-upgrade check in `docs/commands.md`
- [x] 5.2 Document `npm run check:skills-ref` and when to bump `EXPECTED_SKILLS_REF` for probe releases
