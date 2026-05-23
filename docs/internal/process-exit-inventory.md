# process.exit inventory

Verified via `rg 'process\.exit' src/` on 2026-05-23 (wave 6.5).

## Direct call sites

| File                    | Role                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `src/utils/boundary.ts` | Sole direct `process.exit` usage — `installProbeExitHook`, `renderProbeErrorAndExit`, `exitProcess` |

## Boundary consumers (no direct `process.exit`)

| File                           | Mechanism                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| `src/index.ts`                 | `renderProbeErrorAndExit` for unhandled rejections; citty exit hook |
| `src/commands/doctor.ts`       | `exitProcess(1)` when checks fail after success output              |
| `src/commands/nexus-daemon.ts` | `renderProbeErrorAndExit` on harness startup failure                |

## Migrated away

| File                  | Notes                                                   |
| --------------------- | ------------------------------------------------------- |
| `src/utils/output.ts` | `error()` throws `ProbeError`; boundary renders at exit |

## Citty integration

`installProbeExitHook()` intercepts `process.exit` when a `ProbeError` was thrown so citty's catch path renders JSON/text via `renderProbeError` before exiting.
