# Host / module flag inventory

Commands that declare `--host` and/or `--module` must forward those values through
`commandContextOptions()` to `CommandContext.create` or `withAuth`. Wave 2 (task 2.7)
migrates call sites; this checklist tracks coverage.

Legend: `[ ]` not migrated · `[x]` forwards via `commandContextOptions`

## Top-level commands

| Command          | Declares flags | Forwards | Notes                                                         |
| ---------------- | -------------- | -------- | ------------------------------------------------------------- |
| `doctor`         | yes            | [x]      | Passes host/module to `runHealthChecks` directly              |
| `onboard`        | yes            | [x]      | Forwards via `commandContextOptions` in onboard steps         |
| `query`          | yes            | N/A      | Uses `resolveSpacetimeArgs` + HTTP SQL (not `CommandContext`) |
| `whoami`         | yes            | [x]      |                                                               |
| `nexus` (daemon) | yes            | [x]      | Uses `commandContextOptions` in daemon `withAuth` loop        |

## `probe action` subcommands

| Subcommand        | Declares flags | Forwards |
| ----------------- | -------------- | -------- |
| `show`            | yes            | [x]      |
| `complete`        | yes            | [x]      |
| `fail`            | yes            | [x]      |
| `skip`            | yes            | [x]      |
| `review`          | yes            | [x]      |
| `validate-review` | yes            | [x]      |

## `probe agent cooldown` subcommands

| Subcommand | Declares flags | Forwards |
| ---------- | -------------- | -------- |
| `show`     | yes            | [x]      |
| `set`      | yes            | [x]      |
| `off`      | yes            | [x]      |
| `inherit`  | yes            | [x]      |

## Nexus command groups

| Command          | Declares flags | Forwards |
| ---------------- | -------------- | -------- |
| `probe message`  | yes            | [x]      |
| `probe task`     | yes            | [x]      |
| `probe agent`    | yes            | [x]      |
| `probe project`  | yes            | [x]      |
| `probe idea`     | yes            | [x]      |
| `probe discover` | yes            | [x]      |

## Onboard steps (internal)

Steps in `src/utils/onboard/steps.ts` pass host/module via `commandContextOptions` — [x] migrated.
