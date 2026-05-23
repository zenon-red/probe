## 1. Essential State

- [x] 1.1 Add `commandContextOptions(args, extra?)` in `src/utils/context.ts` — forward only explicit wallet/host/module (no config I/O)
- [x] 1.2 Add `ProbeError` class in `src/utils/errors.ts` with code, message, suggestion, exitCode from `exitCodeFor`
- [x] 1.3 Add shared boundary renderer (e.g. `renderProbeErrorAndExit`) used by `index.ts`, `doctor.ts`, and `nexus-daemon.ts`
- [x] 1.4 Add `MessageTarget` type and `resolveMessageTarget()` in `src/commands/nexus/message-target.ts` with rules: numeric → project; non-numeric → channel name; `project:<id>` / `channel:<name|id>` prefixes
- [x] 1.5 Add `inferTableNameSafe(sql)` returning `{ table?, confidence }` in `src/utils/sql-decode.ts`
- [x] 1.6 Inventory all commands declaring `--host` / `--module`; document checklist
- [x] 1.7 Inventory all `process.exit` call sites in `src/` via grep; document exceptions

## 2. Essential Logic

- [x] 2.1 Export `parseEnums` from `scripts/generate-decoders.ts` (or shared module) for test use
- [x] 2.2 Generate and export `ENUM_VARIANTS` map from `generate-decoders.ts` for drift comparison
- [x] 2.3 Add enum drift test comparing bindings enums to `ENUM_VARIANTS` (via generator import — no dependency on committed `decoders.ts`)
- [x] 2.4 Wire `generate:decoders` into `build` and add `pretest:ci` / `pretest` so tests run after generation on fresh checkout
- [x] 2.5 Add unit tests for `commandContextOptions` — all three forwarded; omitted flags stay undefined (no config fallback in helper)
- [x] 2.6 Add unit test that config defaults are applied by `CommandContext.create` when helper omits host/module
- [x] 2.7 Replace ad-hoc `CommandContext.create({})` / `withAuth({ wallet })` with `commandContextOptions` across all STDB commands (nexus, action, cooldown, whoami, onboard steps, etc.)
- [x] 2.8 Add unit tests proving host/module reach `CommandContext.create` for one read command and one write command
- [x] 2.9 Refactor `output.ts` `error()` to throw `ProbeError`; wire boundary renderer in `index.ts`
- [x] 2.10 Migrate `doctor.ts` and `nexus-daemon.ts` fatal exits to shared boundary renderer (or document exceptions)
- [x] 2.11 Update `index.ts` unhandledRejection handler to use boundary rendering instead of bare exit
- [x] 2.12 Extract shared `listMessages(ctx, target, kind, limit, context?)` used by list and directives
- [x] 2.13 Extract shared `sendMessage(ctx, target, content, typePolicy)` used by send and directive
- [x] 2.14 Add unit tests for message target: numeric project, named channel, numeric channel requires `channel:` prefix, prefixed channel, missing project, missing channel, directive type restriction, raw content validation
- [x] 2.15 Implement safe SQL decode policy in `query.ts`: decode when unambiguous, raw + metadata when ambiguous
- [x] 2.16 Add unit tests for SQL: simple select, `SELECT * FROM tasks t`, `SELECT t.status FROM tasks t`, join, multi-statement, schema-qualified, unknown table, `--raw`, `--decode`
- [x] 2.17 Add `runReducerCommand` helper in `src/utils/reducer-command.ts`; migrate repeated try/catch in all nexus handler groups and action
- [x] 2.18 Add unit tests for reducer wrapper success and REDUCER_FAILED mapping

## 3. Accidental State and Control

- [x] 3.1 Remove global `console.log` / `console.error` mutation from `CommandContext.create`
- [x] 3.2 Replace `identity: undefined as unknown as Identity` with explicit pending-auth representation
- [x] 3.3 Add typed table getters on `CommandContext` for all CLI-read tables (agents, agentActions, tasks, taskDependencies, projects, ideas, votes, evaluationDimensions, messages, channels, projectMessages, projectChannels, discoveredTasks, config, …) using `conn.db.<table>.iter()` and types from `module_bindings/types.ts`
- [x] 3.4 Migrate call sites from `ctx.iter<T>(…)` and ad-hoc `ctx.db as Record<…>` to typed getters (nexus handlers, action, agent-cooldown, whoami, onboard/steps, health, daemon session)
- [x] 3.5 Remove public `iter<T>(tableName)` from `CommandContext` after migration
- [x] 3.6 Narrow `callProcedure` typing where practical; reduce `any` usage
- [x] 3.7 Split `nexus-daemon.ts` into `src/daemon/events.ts`, `harness-runner.ts`, `session.ts`, `action-executor.ts`, `loop.ts`
- [x] 3.8 Keep `nexus-daemon.ts` as thin CLI wrapper (args, help, dispatch to loop)
- [x] 3.9 Add unit tests for daemon harness outcomes: clean exit, non-zero exit, signal, timeout, spawn failure
- [x] 3.10 Add unit tests for daemon event filtering and JSON sanitization
- [x] 3.11 Add unit tests for reconnect/backoff behavior with mocked connection (no live STDB)
- [x] 3.12 Add unit tests for daemon invariants: one action at a time, spawn violation event, heartbeat cadence/jitter, non-fatal run-started/run-finished reducer failures, outcome semantics
- [x] 3.13 Expand `test:ci` in `package.json` to run all `tests/unit/*.test.ts`

## 4. Feeders and Observers — Nexus subcommands

- [x] 4.1 Convert `probe message` to citty subcommands: list, directives, send, directive, channels; remove positional `action` and `message-handlers` switch
- [x] 4.2 Convert `probe task` to citty subcommands: list, ready, get, create, claim, update, review, deps, watch; remove `task-handlers` switch
- [x] 4.3 Convert `probe agent` to citty subcommands: register, status, set-status, capabilities, me, bio, heartbeat, list, identity, voice; remove `agent-handlers` switch
- [x] 4.4 Convert `probe project` to citty subcommands: list, get, status, create, set-status; remove inline switch in `project.ts`
- [x] 4.5 Convert `probe idea` to citty subcommands: list, pending, get, dimensions, propose, vote; remove inline switch in `idea.ts`
- [x] 4.6 Convert `probe discover` to citty subcommands: report, review, list, get; remove inline switch in `discover.ts`
- [x] 4.7 Delete or gut mega-handler files (`message-handlers.ts`, `task-handlers.ts`, `agent-handlers.ts`); logic moves to per-subcommand modules

## 5. Feeders and Observers — Other CLI subcommands

- [x] 5.1 Convert `probe config` to citty subcommands: get, set, list; remove positional `action` switch in `config.ts`
- [x] 5.2 Add top-level `probe login <wallet>`; keep `probe auth status` only (no `auth login`, no bare `probe auth <wallet>`)
- [x] 5.3 Convert `probe token` to citty subcommands: show, clear; remove `--clear` mode flag on parent
- [x] 5.4 Verify `probe action`, `probe wallet`, `probe cooldown` already use citty `subCommands`; align shared parent args (host/module/json) with new pattern only where needed — action/cooldown subcommands now use `commandContextOptions` for host/module forwarding
- [x] 5.5 Confirm no subcommand conversion for single-purpose commands: query, doctor, whoami, onboard, upgrade, sign, nexus (plumbing only) — already single top-level commands; no change

## 6. Feeders and Observers — Tests and docs

- [x] 6.1 Add subcommand-level tests for representative commands across all converted groups (nexus + config + auth + token)
- [x] 6.2 Add action ownership verification unit tests per TODO in `action.ts`
- [x] 6.3 Update `probe query --help` and docs for decode limitations
- [x] 6.4 Rewrite `docs/commands.md`, `skills/probe/SKILL.md`, `skills/probe/references/commands.md` for subcommand-only CLI (breaking — includes auth login, token show/clear, config get/set/list)
- [x] 6.5 Verify grep of `process.exit` in `src/` shows only documented exceptions for expected failures
- [x] 6.6 Run `npm run typecheck`, `npm run lint`, `npm run test:ci`; fix any regressions
