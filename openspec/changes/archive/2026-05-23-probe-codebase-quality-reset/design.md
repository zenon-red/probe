## Context

Probe CLI connects to SpacetimeDB via `CommandContext`, exposes nexus CRUD commands through citty, and runs a long-lived `probe nexus` daemon for harness execution. A codebase audit (`docs/todo/prd-probe-codebase-quality-reset.md`) identified ten structural issues spanning schema decoding, connection flag wiring, command dispatch, daemon density, error boundaries, and test gaps.

The codebase already has `scripts/generate-decoders.ts` parsing `module_bindings/types.ts`, but `src/generated/` is gitignored and nothing asserts enum parity. Many handlers advertise `--host` / `--module` but call `CommandContext.create({})` or `withAuth({ wallet })` without forwarding.

This change is self-contained within the probe repo.

## Goals / Non-Goals

**Goals:**
- One canonical source for schema-derived SQL decoding with drift enforcement
- Consistent `--wallet`, `--host`, `--module` forwarding across all commands
- Testable command handlers via typed errors and decomposed daemon modules
- Explicit citty subcommands for nexus groups (message, task, agent, project, idea, discover) plus config and token; top-level `probe login` and `probe auth status` only
- Safe SQL decode policy that never silently mislabels enum columns
- Typed table accessors on `CommandContext` sourced from generated STDB bindings
- High-risk unit test coverage included in CI

**Non-Goals:**
- Redesign Nexus STDB reducers or schema
- Introduce a command framework or large abstraction layer
- Rewrite generated SpacetimeDB bindings manually
- Backward compatibility shims for positional `action` dispatch (removed entirely)
- Optimize network performance beyond removing duplicated orchestration

## Cross-repo Scope

None. All work is within `workspace/zenon-red/probe`.

## Essential State

Base relations the CLI must retain or derive correctly:

| Relation | Attributes | Integrity |
|----------|------------|-----------|
| `ConnectionTarget` | `wallet?`, `host?`, `module?`, `token?` | Helper forwards only explicit overrides; `CommandContext.create` resolves config defaults |
| `EnumBinding` | `enumName`, `variants[]` | Sourced from `module_bindings/types.ts` |
| `EnumDecoder` | `enumName`, `variants[]` | For each enumName, variants SHALL equal EnumBinding.variants |
| `MessageTarget` | `kind` ∈ {project, channel}, `id`, `name` | Numeric-only input → project; non-numeric → channel name; prefixed `project:<id>` / `channel:<name\|id>` for explicit disambiguation |
| `CommandArgs` | per-subcommand typed fields | Invalid combinations rejected before connection |
| `ProbeErrorRecord` | `code`, `message`, `suggestion?`, `exitCode` | exitCode derived from code via existing `exitCodeFor` |

**Constraints:**
- When a command declares `--host` or `--module`, the resolved ConnectionTarget SHALL include those values
- EnumDecoder.variants mismatch with EnumBinding.variants SHALL fail the drift, drift test
- SQL decode application requires unambiguous single-table inference; otherwise output is raw

## Essential Logic

Pure derivations and functions (no I/O):

| Function / Derivation | Input | Output |
|-----------------------|-------|----------|
| `commandContextOptions(args, extra?)` | wallet?, host?, module?, extra opts | `CommandContextOptions` forwarding only explicit args (no config I/O) |
| `parseBindingEnums()` / `ENUM_VARIANTS` | bindings source | exported variant map for drift tests |
| `resolveMessageTarget(input, projects, channels)` | target string or numeric id | `MessageTarget` or validation error |
| `inferTableNameSafe(sql)` | SQL string | `{ table, confidence: unambiguous \| ambiguous \| none }` |
| `enumVariantsMatch(bindings, decoders` | two enum maps | boolean + diff list |
| `ProbeError.of(code, message, suggestion?)` | error fields | `ProbeError` with exitCode |
| `filterMessagesByKind(messages, kind)` | messages, user \| directive | filtered, sorted list |

Reducer parameter construction and business validation remain at each command call site — not inside wrappers.

## Accidental State and Control

Performance and infrastructure hints (removable without correctness loss):

- **Cache generated decoders on disk** (`src/generated/decoders.ts`) — regenerate from bindings; gitignored artifact
- **Run `generate:decoders` before build and test:ci** — ensures artifact exists locally (gitignored)
- **Drift tests import `parseEnums` from generator or `ENUM_VARIANTS` export** — tests work on fresh checkout without committed generated files
- **Console suppression during SDK connect** — REMOVE (accidental; replaced by SDK log handling or PROBE_DEBUG only)
- **Daemon event log file sink** — keep; accidental persistence for operator debugging
- **Harness spawn timeout** — keep existing config-driven timeout

## Feeders / Observers

| Boundary | Role |
|----------|------|
| citty CLI entry (`src/index.ts`) | Catches `ProbeError`, renders JSON/text, sets exit code |
| Shared boundary renderer | Used by `index.ts`, `doctor.ts`, and `nexus-daemon.ts` for fatal exits |
| Command handlers | Parse args → essential state → call context/reducers → emit success |
| `generate-decoders.ts` | Reads bindings files → writes EnumDecoder + TABLE_DECODERS |
| Daemon JSONL stdout | Observer for harness/session events; event names MUST remain stable |
| SQL HTTP endpoint | External read; decode applied only when `inferTableNameSafe` is unambiguous |

## Decisions

| Decision | Classification | Rationale |
|----------|----------------|-----------|
| Drift test compares bindings enums to generated decoders | Essential | Catches silent query lies; cheap CI gate |
| `commandContextOptions()` forwards explicit args only | Essential | Fixes host/module bug; no hidden config I/O in helper |
| Export `ENUM_VARIANTS` from generated decoders | Essential | Drift tests compare maps without brittle source parsing |
| Single boundary renderer for index/doctor/daemon | Essential | One exit/render path; grep inventory for all `process.exit` |
| `ProbeError` thrown from `error()` initially, render at index | Essential | Unblocks handler unit tests; incremental migration |
| Message target extraction before subcommand conversion | Essential | Avoid double refactor |
| Subcommands for all six nexus groups; no backward compat | Essential | One CLI pattern; removes all mega-switches in this change |
| `runReducerCommand` thin wrapper | Accidental DRY | Deletes boilerplate; params stay local |
| Daemon split into 5 modules under `src/daemon/` | Accidental structure | Testability; no behavior change |
| SQL: decode when unambiguous, else raw + metadata | Essential | Agent trust over convenience |
| Handwritten `enums.ts` helpers retained with optional drift test | Essential derived | UX helpers (fromString, matches); distinct from SQL decoders |
| Typed table getters on CommandContext from `conn.db` bindings | Essential | Compile-time table access; removes stringly `iter<T>()` and db casts |
| Docs/skills rewritten in same change | Essential | Breaking CLI requires updated agent contracts |
| Expand `test:ci` to all unit tests in `tests/unit/` | Essential | Phase 10 meaningless otherwise |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Subcommand conversion breaks old docs/skills | Rewrite docs/skills in same change; subcommand-level tests |
| Decoder fix exposes previously wrong output | Document fix; retain `--raw`; drift test in CI |
| `process.exit` removal touches many files | Introduce `ProbeError` behind `error()` first; migrate incrementally |
| Daemon extraction alters lifecycle timing | Preserve JSONL event names; harness/reconnect tests before deep rewrite |
| SQL raw fallback changes default output shape | Update help/docs; `--decode` forces decode when unambiguous |

## Open Questions

1. **Resolved for implementation:** SQL defaults to safe decode (raw when ambiguous), not decode-on with heuristic-only inference.
2. **Resolved for implementation:** All nexus groups plus config/token convert to subcommands; OIDC via top-level `probe login`; `probe auth status` only under `auth`; no backward compat shims.
3. **Resolved for implementation:** Typed table accessors on `CommandContext` — see below.

### Typed table accessors

**Today:** commands read STDB tables via untyped dynamic access:

```ts
ctx.iter<Task>("tasks")           // caller picks T; no compile-time link to table name
ctx.db as Record<string, ...>     // action.ts, agent-cooldown.ts
```

**Target:** typed getters on `CommandContext` backed by generated bindings (`conn.db.<table>.iter()`):

```ts
get tasks(): Task[] {
  return Array.from(this.conn.db.tasks.iter());
}
get agents(): Agent[] {
  return Array.from(this.conn.db.agents.iter());
}
get agentActions(): AgentAction[] {
  return Array.from(this.conn.db.agent_actions.iter());
}
```

Call sites use `ctx.tasks` instead of `ctx.iter<Task>("tasks")`. Types come from `module_bindings/types.ts` — same source as reducers and decoders.

**Scope:** getters for every table read by CLI commands (agents, agent_actions, tasks, task_dependencies, projects, ideas, votes, evaluation_dimensions, messages, channels, project_messages, project_channels, discovered_tasks, config, …). Remove public `iter<T>(tableName)` after migration. Replace ad-hoc `ctx.db as Record<…>` in `action.ts`, `agent-cooldown.ts`, and similar.

**Timing:** add getters during CommandContext cleanup (§3); migrate call sites as handlers move to subcommand modules.
