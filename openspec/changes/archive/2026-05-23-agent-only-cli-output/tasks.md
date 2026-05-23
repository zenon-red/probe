## 7. Plain output + doctor redesign

### 7A — Plain help and no color anywhere

- [x] 7.1 Rewrite `printHelp` / `printConciseRootHelp` — plain text only (no kolorist, no neonBadge/ANSI)
- [x] 7.2 Remove `kolorist` and `consola` from `package.json`; remove `--pretty` and consola from `nexus-daemon.ts`
- [x] 7.3 Add `tests/unit/help.test.ts` — assert help output contains no ESC bytes
- [x] 7.4 Docs: help plain-text note in `docs/llms.txt` + `README.md`; remove `--pretty` from docs/skills/specs

### 7B — Machine-grade doctor

- [x] 7.5 Add `DoctorIssue` model + stable code mapping in `src/utils/doctor-issues.ts`
- [x] 7.6 Redesign `runHealthChecks` — env writability probes, `issues[]` only (drop `checks[]`)
- [x] 7.7 Rewrite `doctor.ts` — `--fix` (mkdir/clear-token/single-wallet default), `--no-agent`, non-zero exit when `!ok`
- [x] 7.8 Add `tests/unit/doctor.test.ts` — code mapping, next_commands, `--fix` registry
- [x] 7.9 Extend `docs/llms.txt` with doctor issue table + `--fix` semantics; update delta spec
