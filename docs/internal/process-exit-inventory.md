# Process exit boundary

Probe centralizes process termination so command code stays testable and errors are rendered consistently.

## Invariant

Only `src/utils/boundary.ts` should call `process.exit` directly.

Command handlers should either:

- throw a `ProbeError` via `error()` for failures, or
- call `exitProcess(code)` when a command must emit a successful payload before returning a failing exit code.

## Boundary consumers

| File                           | Mechanism                                               |
| ------------------------------ | ------------------------------------------------------- |
| `src/index.ts`                 | Installs the citty exit hook and renders fatal errors   |
| `src/commands/doctor.ts`       | Uses `exitProcess(1)` when diagnostics contain failures |
| `src/commands/nexus-daemon.ts` | Renders startup failures through the boundary           |

## Citty integration

`installProbeExitHook()` intercepts citty's `process.exit` path after a `ProbeError` so `renderProbeErrorAndExit()` can render the structured Probe error before terminating.

When adding new commands, do not call `process.exit` directly from command logic.
