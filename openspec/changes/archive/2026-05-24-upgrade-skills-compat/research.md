## Codebase Exploration

### `probe upgrade` today

- `src/commands/upgrade.ts` — version metadata only; no skills awareness.

### Related probe code

- `src/utils/skills-install.ts` — unpinned `npx skills add zenon-red/skills --skill='*' -y -g` (to be replaced with shared `#ref` constant).
- `zenon-red/skills` git tags: `v0.2.0` … `v0.3.3`.

## Skills CLI verification (`~/research/skills`)

| Fact | Detail |
|------|--------|
| Lock path | `$XDG_STATE_HOME/skills/.skill-lock.json` or `~/.agents/.skill-lock.json` |
| Lock shape | `{ skills: Record<string, SkillLockEntry> }` |
| Global install | One lock row per skill name; shared `source` and `ref` when installed together |
| `#ref` on add | Stored in `SkillLockEntry.ref` |
| `skills update -g` | Refreshes content on **locked** ref; does not bump to a new tag |

## Recommended approach

1. Export `EXPECTED_SKILLS_*` and pinned install command from `skills-check.ts`.
2. Use pinned install in `skills-install.ts`.
3. After successful `probe upgrade`, read lock and compare all `zenon-red/skills` rows.

No transitional unpinned onboard path.

## Release reminder

- `scripts/check-skills-ref.ts` + `npm run check:skills-ref` (`npx tsx`)
- Warn on `check:push`; `--strict` in `release-binaries.yml` before publish
- Reads same constant as runtime (no env var, no auto-bump)

## Sources

- `~/research/skills/src/skill-lock.ts`, `add.ts`, `update.ts`
- `src/utils/skills-install.ts`
