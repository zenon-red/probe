# PRD: Probe CLI Codebase Quality Reset

## Status

- Draft
- Owner: Probe CLI
- Scope: `src/commands`, `src/utils`, `src/generated`, tests, CLI docs where behavior changes are user-visible
- Source: Thermo-nuclear code quality audit of the whole Probe CLI codebase

## Problem

Probe works as a compact all-in-one Nexus CLI, but the implementation has accumulated structural debt in the exact places where correctness matters most for agents:

- schema knowledge is duplicated across generated bindings, generated SQL decoders, handwritten enum helpers, and command-specific parsers;
- several commands advertise `--host` and `--module` but do not reliably pass those overrides into the connection layer;
- many command groups use a single positional `action` switch with a shared optional argument bag, creating weak boundaries and repeated validation;
- daemon orchestration, session management, event logging, heartbeat, subscriptions, and harness execution live in one large file;
- output/error utilities terminate the process from deep helper code, making handlers hard to test and compose;
- SQL decoding presents itself as generic while relying on fragile table inference and stale decoder data;
- tests cover only a small subset of the riskiest behavior.

This is not primarily a formatting issue. The CLI needs a structural cleanup so command behavior is easier to reason about, schema drift is harder to ship, and agent-facing contracts are reliable.

## Goals

1. Make schema-derived behavior use one canonical source of truth.
2. Ensure connection-target flags (`--wallet`, `--host`, `--module`) behave consistently across every command.
3. Replace large positional action switches with explicit subcommands where it materially improves type boundaries and maintainability.
4. Split daemon internals along real state-machine boundaries so harness execution and reconnect behavior can be tested in isolation.
5. Make command errors testable by throwing typed errors and rendering/exiting only at the CLI boundary.
6. Remove duplicate command plumbing without adding magical abstractions.
7. Add tests around the high-risk behavior uncovered by the audit.

## Non-Goals

- Do not redesign Nexus server reducers or SpacetimeDB schema except where needed to consume generated metadata correctly.
- Do not change user-facing command semantics unless the current behavior is documented but broken.
- Do not introduce a framework or large command abstraction layer.
- Do not optimize network performance beyond removing avoidable sequential or duplicated orchestration.
- Do not rewrite generated SpacetimeDB bindings manually.

## Current Findings

### 1. Schema and enum knowledge is duplicated and stale

Affected files:

- `src/module_bindings/types.ts`
- `src/generated/decoders.ts`
- `src/utils/enums.ts`
- `src/commands/query.ts`
- command-specific parsers such as `src/commands/nexus/discover.ts`

`src/generated/decoders.ts` contains hard-coded enum variants that already disagree with `src/module_bindings/types.ts`. For example, generated bindings define current `ActionKind` values such as `ExecuteTask`, `ReviewTask`, `ValidateReview`, and `MergeReadyTask`, while the SQL decoder still lists older values such as `ContinueTask`, `ClaimTask`, `ValidateReviews`, and `Idle`.

This can make `probe query --decode` silently report the wrong action kind. A CLI inspection command must not lie.

### 2. `--host` and `--module` are inconsistently wired

Affected files include:

- `src/commands/nexus/task-handlers.ts`
- `src/commands/nexus/agent-handlers.ts`
- `src/commands/nexus/message-handlers.ts`
- `src/commands/nexus/project.ts`
- `src/commands/nexus/idea.ts`
- `src/commands/nexus/discover.ts`

These command argument shapes and help text often expose `host` and `module`, but handlers frequently call `CommandContext.create({})` or `withAuth({ wallet: args.wallet })` without forwarding those overrides.

This is a correctness bug and an architecture smell: command files are each responsible for remembering connection plumbing.

### 3. Command groups use mega-switches and weak shared arg bags

Affected files:

- `src/commands/nexus/task-handlers.ts`
- `src/commands/nexus/agent-handlers.ts`
- `src/commands/nexus/message-handlers.ts`
- `src/commands/nexus/project.ts`
- `src/commands/nexus/idea.ts`
- `src/commands/nexus/discover.ts`

Large `switch (action)` handlers force unrelated actions to share optional arguments. That leads to repeated validation, hidden invalid combinations, weak typing, and more ad-hoc branches over time.

### 4. `nexus-daemon.ts` has too many responsibilities

Affected file:

- `src/commands/nexus-daemon.ts`

The daemon file currently owns CLI help, config resolution, harness detection, event logging, signal handling, reconnect/backoff, auth/session lifecycle, subscriptions, action filtering, prompt building, child process lifecycle, timeout handling, heartbeat scheduling, and reducer reporting.

At 594 lines it is under the 1k hard limit, but it is structurally dense and risky. The file-level TODO already calls out missing tests for harness lifecycle and reconnection behavior.

### 5. `CommandContext` hides unsafe global behavior

Affected file:

- `src/utils/context.ts`

Current issues:

- mutates global `console.log` and `console.error` while connecting;
- uses `identity: undefined as unknown as Identity`;
- exposes `iter<T>(tableName)` so callers can cast dynamic tables to any expected type;
- uses `any` in `callProcedure`;
- mixes config, wallet token lookup, SDK connection, subscriptions, auth state, timeout, and disposal.

This boundary is convenient but too broad. It encourages callers to cast around unclear invariants.

### 6. SQL decoding is overly magical

Affected files:

- `src/commands/query.ts`
- `src/utils/sql.ts`
- `src/generated/decoders.ts`

`query.ts` infers a table with a simple `FROM\s+(\w+)` regex and applies that table's decoders to all statement results. That is fragile for joins, aliases, CTEs, multiple statements, expressions, subqueries, schema-qualified names, and stale decoder output.

### 7. Message command duplicates whole target-resolution flows

Affected file:

- `src/commands/nexus/message-handlers.ts`

`list` and `directives` are nearly identical except for the message-type predicate. `send` and `directive` are nearly identical except for type policy. Both duplicate numeric project-target vs named channel-target resolution.

### 8. Reducer call patterns are repeated everywhere

Affected files:

- `src/commands/action.ts`
- `src/commands/nexus/task-handlers.ts`
- `src/commands/nexus/agent-handlers.ts`
- `src/commands/nexus/project.ts`
- `src/commands/nexus/idea.ts`
- `src/commands/nexus/discover.ts`

Most mutating commands repeat:

1. parse/validate args;
2. open authenticated context;
3. call one reducer;
4. catch and map reducer errors;
5. emit success.

This is a good candidate for a small, explicit helper that deletes mechanical duplication while keeping parameter construction local.

### 9. Errors exit from deep utility code

Affected file:

- `src/utils/output.ts`

`error(...)` calls `process.exit(...)`. This makes validation and command logic harder to unit test and prevents normal composition. Only the CLI entrypoint should render and exit.

### 10. Tests miss the riskiest behavior

Affected files:

- `tests/unit/*`

Missing coverage includes:

- schema decoder drift detection;
- host/module propagation;
- daemon harness outcomes;
- daemon reconnect/backoff behavior;
- action ownership verification;
- message target resolution;
- command validation and typed error rendering;
- query decoding edge cases.

## Proposed Solution

Implement this as a sequence of focused refactors. Each phase should preserve behavior except where it fixes documented broken behavior.

## Phase 1: Canonical Schema-Derived Decoding

### Requirements

1. `src/generated/decoders.ts` must be generated from the same schema source as `src/module_bindings/types.ts`, or from a machine-readable schema emitted by SpacetimeDB.
2. Generated enum decoder variants must match the generated binding enum variants.
3. Add a test that fails if decoder enum variants drift from binding enum variants.
4. Remove stale hard-coded enum variants from handwritten code where possible.
5. If reliable generic SQL decoding is not possible for a query shape, prefer raw output over guessed decoded output.

### Acceptance Criteria

- `ActionKind`, `ActionEventType`, and all other enum decoders match generated bindings.
- `npm run generate:decoders` produces deterministic output.
- Unit tests fail when an enum exists in bindings but decoder metadata is stale.
- `probe query --raw` remains available.
- Default `probe query` output does not silently misdecode known enum columns.

## Phase 2: Canonical Connection Options

### Requirements

1. Introduce one helper for converting command args into `CommandContextOptions`.
2. The helper must forward `wallet`, `host`, and `module` consistently.
3. Replace direct ad-hoc calls like `withAuth({ wallet: args.wallet })` with the canonical helper.
4. Add tests for at least one read command and one write command proving host/module overrides reach `CommandContext.create` / `withAuth`.

Example shape:

```ts
function commandContextOptions(
  args: { wallet?: string; host?: string; module?: string },
  extra?: Omit<CommandContextOptions, "wallet" | "host" | "module">,
): CommandContextOptions;
```

### Acceptance Criteria

- Every command that declares `--host` or `--module` forwards those values.
- Help text and implementation agree.
- No command constructs context options by hand unless there is a documented reason.

## Phase 3: Typed Command Decomposition

### Requirements

1. Convert the highest-risk positional action switches to explicit `citty` subcommands.
2. Start with `message` and `task` because they have the most duplication and branching.
3. Each subcommand should declare only its own accepted args.
4. Keep command behavior and output stable unless fixing a broken documented flag.
5. Avoid introducing a large generic command framework.

Recommended order:

1. `message list`, `message directives`, `message send`, `message directive`, `message channels`
2. `task list`, `task ready`, `task get`, `task create`, `task claim`, `task update`, `task review`, `task deps`, `task watch`
3. `agent` actions
4. `idea`, `project`, `discover`

### Acceptance Criteria

- Shared mega-arg interfaces shrink or disappear.
- Invalid flag combinations are prevented by per-subcommand arg definitions or small local validation.
- Existing documented command examples still work.
- Tests cover representative subcommands.

## Phase 4: Message Target Model

### Requirements

1. Extract one target resolver for message commands.
2. Model target resolution explicitly:

```ts
type MessageTarget =
  | { kind: "project"; projectId: bigint; projectName: string }
  | { kind: "channel"; channelId: bigint; channelName: string };
```

3. Use one list function parameterized by message kind (`user` vs `directive`).
4. Use one send function parameterized by message type policy.

### Acceptance Criteria

- Project/channel target resolution exists once.
- `list` and `directives` share the same retrieval/sort/limit flow.
- `send` and `directive` share the same target/reducer flow.
- Unit tests cover numeric project target, named channel target, missing project, missing channel, directive type restriction, and raw content validation.

## Phase 5: Reducer Command Wrapper

### Requirements

1. Extract a small helper for the repeated authenticated reducer pattern.
2. Keep reducer parameter construction explicit and local to each command.
3. Centralize mapping of reducer failures to `REDUCER_FAILED` only where appropriate.
4. Do not hide command-specific validation inside the helper.

Example shape:

```ts
async function runReducerCommand<TParams, TResult>(
  args: ConnectionArgs,
  options: {
    subscribe?: string[];
    reducer: (ctx: CommandContext) => (params: TParams) => Promise<void>;
    params: (ctx: CommandContext) => TParams | Promise<TParams>;
    result: (params: TParams) => TResult;
  },
): Promise<void>;
```

### Acceptance Criteria

- Repeated `try { await withAuth ... callReducer ... } catch { error("REDUCER_FAILED") }` blocks are substantially reduced.
- Business validation remains readable at each call site.
- Tests cover success and reducer failure mapping.

## Phase 6: Daemon Decomposition

### Requirements

Split `src/commands/nexus-daemon.ts` into focused modules.

Recommended modules:

- `src/daemon/events.ts`
  - event type definitions
  - JSON replacer/sanitizer
  - log-level filtering
  - stdout/log-file event sink
- `src/daemon/harness-runner.ts`
  - harness spawn argument construction
  - child process execution
  - timeout handling
  - outcome mapping (`Clean`, `Signal`, `Timeout`, `SpawnFailed`)
- `src/daemon/session.ts`
  - authenticated connection
  - own-agent lookup
  - subscription setup
- `src/daemon/action-executor.ts`
  - prompt construction
  - run-started/run-finished reducer calls
  - harness runner integration
- `src/daemon/loop.ts`
  - reconnect/backoff
  - signal handling
  - heartbeat scheduling
- `src/commands/nexus-daemon.ts`
  - CLI args/help only

### Acceptance Criteria

- `commands/nexus-daemon.ts` becomes a thin command wrapper.
- Harness runner can be unit-tested with mocked spawn behavior.
- Backoff/reconnect behavior can be tested without a real SpacetimeDB connection.
- Event filtering/sanitization can be unit-tested independently.
- Existing daemon JSONL event names remain stable.

## Phase 7: Typed Error Boundary

### Requirements

1. Introduce a `ProbeError` class or equivalent typed error object.
2. Replace deep `process.exit` calls with thrown `ProbeError`s.
3. Render errors and set process exit code only at `src/index.ts` or a single CLI boundary helper.
4. Preserve JSON and TOON/text error output contracts.
5. Update tests to assert thrown errors or rendered boundary output without process termination.

Example:

```ts
class ProbeError extends Error {
  code: string;
  suggestion?: string;
  exitCode: number;
}
```

### Acceptance Criteria

- `src/utils/output.ts` no longer calls `process.exit` from `error(...)` or `error(...)` is replaced with a throwing helper.
- Command handlers can be tested without monkeypatching `process.exit`.
- CLI behavior remains the same for users.

## Phase 8: CommandContext Boundary Cleanup

### Requirements

1. Remove global `console.log` / `console.error` mutation from `CommandContext.create`.
2. Replace `identity: undefined as unknown as Identity` with an explicit pending-auth representation.
3. Narrow dynamic table access where practical.
4. Replace `any` in `callProcedure` with typed procedure helpers or constrained generics.
5. Separate auth token resolution from SDK connection setup.

### Acceptance Criteria

- No global console mutation in context creation.
- No fake `Identity` value exists before connection.
- Callers that need auth identity receive it only after connection.
- Type casts in command files decrease, not move around.

## Phase 9: SQL Query Behavior Cleanup

### Requirements

1. Decide and document the SQL command model:
   - raw inspector by default, or
   - typed table decoder only for query shapes that can be proven safe.
2. If decoding remains default, detect unsupported query shapes and fall back to raw with metadata instead of guessing.
3. Support multiple statements safely, with per-statement table inference only when unambiguous.
4. Validate response row shape before casting to `unknown[][]`.

### Acceptance Criteria

- SQL decoding does not apply one inferred table decoder to unrelated result sets.
- Tests cover simple select, alias, join, multiple statements, unknown table, and raw mode.
- Help text accurately explains decoding limitations.

## Phase 10: Test Expansion

### Required Tests

Add tests for:

1. schema decoder drift detection;
2. `--host`/`--module` propagation in read and auth commands;
3. message target resolution and send/list flows;
4. reducer wrapper success/failure behavior;
5. daemon harness outcomes: clean exit, non-zero exit, signal, timeout, spawn failure;
6. daemon event filtering and JSON sanitization;
7. typed error rendering in JSON and non-JSON modes;
8. SQL decoding edge cases;
9. action ownership verification and wrong-route handling.

### Acceptance Criteria

- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test` includes the new high-risk unit tests.
- Existing documented command examples remain valid.

## Migration Plan

1. Add schema drift tests first to capture current mismatch.
2. Fix decoder generation and generated decoder output.
3. Add canonical context option helper and propagate host/module everywhere.
4. Extract message target model and tests.
5. Convert `message` to subcommands.
6. Convert `task` to subcommands.
7. Extract reducer wrapper where duplication is now obvious.
8. Decompose daemon and add harness/event/reconnect tests.
9. Introduce typed error boundary.
10. Clean `CommandContext` internals.
11. Revisit SQL decoding defaults and update docs/help.

## Risks

- Converting command dispatch may accidentally change CLI invocation compatibility. Mitigate with command-level tests and docs examples.
- Generated decoder changes may expose existing wrong output as a breaking correction. Mitigate by documenting the fix and retaining `--raw`.
- Replacing `process.exit` error flow touches many files. Mitigate by introducing `ProbeError` behind the existing `error(...)` function first, then moving rendering to the boundary.
- Daemon extraction may alter lifecycle timing. Mitigate by preserving event names and adding harness/reconnect tests before deep rewrites.

## Success Metrics

- No stale enum decoder mismatch between generated bindings and query decoders.
- 100% of commands that declare `--host`/`--module` pass them to the context layer.
- `src/commands/nexus-daemon.ts` becomes a thin CLI wrapper, with daemon behavior in testable modules.
- `message` and `task` no longer use large positional `action` switch handlers.
- Command tests can run without real process termination.
- New tests cover the highest-risk behavior identified above.

## Open Questions

1. Should `probe query` default to decoded output only for single-table simple selects, or should decoded output require an explicit `--decode` flag?
2. Can SpacetimeDB expose schema metadata robustly enough for decoder generation, or should generation parse the generated binding artifact?
3. Should context table access remain dynamic for convenience, or should common tables get typed accessors?
4. Should command compatibility preserve all current positional action forms indefinitely, or can aliases be deprecated after subcommands land?
