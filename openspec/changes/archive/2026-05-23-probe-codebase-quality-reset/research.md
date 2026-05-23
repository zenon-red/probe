## Codebase Exploration

Probe is a compact all-in-one Nexus CLI (`src/commands`, `src/utils`, `src/module_bindings`). The baseline spec (`openspec/specs/probe.md`) documents current behavior including output modes, SQL query decoding, and daemon lifecycle.

**Structural debt in high-risk areas:**

| Area | Current state | Risk |
|------|---------------|------|
| Schema decoding | `scripts/generate-decoders.ts` parses `module_bindings/types.ts` into gitignored `src/generated/decoders.ts`; CI regenerates but does not assert parity; `build` does not run generation | Stale enum decoders can silently mislabel `probe query` output |
| Connection flags | `--host` / `--module` declared on many nexus commands; handlers call `CommandContext.create({})` or `withAuth({ wallet })` without forwarding | Overrides silently ignored except in `doctor.ts` and `nexus-daemon.ts` |
| Command dispatch | `task-handlers.ts` (~403 lines), `message-handlers.ts` (~495 lines), peers use `switch (action)` with shared arg bags | Weak typing, repeated validation, hidden invalid combinations |
| Daemon | `nexus-daemon.ts` (594 lines) owns CLI, config, harness, events, reconnect, auth, subscriptions, heartbeat | Hard to test harness/reconnect in isolation |
| Error boundary | `output.ts` `error()` calls `process.exit`; `index.ts` unhandledRejection also exits | Handlers untestable without monkeypatching |
| CommandContext | Global console mutation during connect; `identity: undefined as unknown as Identity`; untyped `iter<T>()` | Unsafe invariants, casts spread to command files |
| SQL query | Default decode on (`args.decode ?? true`); table inference via `FROM\s+(\w+)` regex | Wrong decoders applied to joins, CTEs, multi-statement queries |
| Tests | 7 unit test files exist; `test:ci` runs only `config.test.ts` and `sql.test.ts` | High-risk behavior uncovered |

**Handwritten enum helpers** (`src/utils/enums.ts`) duplicate binding enums for CLI ergonomics (`fromString`, `matches`). This is intentional UX, distinct from generated SQL decoders. TaskStatus currently matches bindings.

**Classification:**

| Data | Class |
|------|--------|
| SpacetimeDB schema / enum variants | Essential derived — must track bindings |
| User config (host, module, wallet) | Essential state |
| Command args and reducer params | Essential state |
| Generated decoders | Essential derived — regenerate from bindings |
| Handwritten enum helpers | Essential derived — acceptable if drift-tested |
| Console suppression during SDK connect | Accidental — remove |
| Shared mega-arg interfaces | Accidental coupling — replace with subcommand args |
| Reducer try/catch boilerplate | Accidental duplication — small explicit helper |

## Sources

- `docs/todo/prd-probe-codebase-quality-reset.md` — audit findings and phased plan
- `openspec/specs/probe.md` — baseline behavior (query decode default, SQL heuristic noted §790)
- `src/utils/context.ts`, `src/utils/output.ts`, `src/commands/nexus/*.ts`, `src/commands/nexus-daemon.ts`
- `scripts/generate-decoders.ts` — existing decoder generation from bindings
- `.github/workflows/ci.yml` — runs `generate:decoders` but no drift assertion
- `package.json` — `test:ci` subset, no prebuild generation hook

## Approach A: Focused Sequential Refactor

Execute a single change with ordered workstreams: enforcement (drift test, build hook) → connection helper → typed errors → message target model → subcommand decomposition → reducer wrapper → daemon split → CommandContext cleanup → SQL policy → test expansion.

Each workstream is a focused PR-sized slice within one change. No new frameworks; small explicit helpers only.

**Feasibility:** High. Matches existing patterns (citty, CommandContext, generate-decoders). Fixes documented bugs while preserving command semantics.

**Complexity:** Medium-high total effort, but each slice is independently shippable and testable once typed errors land early.

## Approach B: Big-Bang Rewrite

Replace command dispatch, context layer, and daemon in one pass before adding tests.

**Feasibility:** Low. High regression risk across agent-facing contracts. Conflicts with "preserve behavior unless broken" constraint.

**Complexity:** High. Touches every command file simultaneously; hard to review and bisect failures.

## Approach C: Test-Only Hardening

Add drift tests, host/module tests, and daemon tests without structural refactors.

**Feasibility:** High for immediate safety nets.

**Complexity:** Low short-term, but leaves mega-switches, untestable error flow, and duplication. Tests for host/module would require mocking around `process.exit` until error boundary changes.

## Recommended Approach

**Approach A — Focused Sequential Refactor** merged into one OpenSpec change. Reorder PRD phases for less rework:

1. Schema drift enforcement (test + build hook)
2. Canonical connection options helper
3. Typed error boundary (early — unblocks handler tests)
4. Message target model + tests
5. All six nexus command groups → citty subcommands (breaking; no compat shims)
6. Reducer command wrapper
7. Daemon module split + tests
8. CommandContext boundary cleanup
9. SQL decode policy (raw default or safe-decode-only)
10. Expand `test:ci` and remaining coverage

Resolve SQL default policy before implementation: prefer decode only when table inference is unambiguous; otherwise raw + metadata (safer for agents than current default).

## Trade-offs

| Topic | A (Sequential) | B (Big-bang) | C (Test-only) |
|-------|----------------|--------------|---------------|
| Correctness fixes (host/module) | Shipped in slice 2 | Delayed until end | Partial — tests expose bug, fix still needed |
| Agent trust (query decode) | Addressed in slice 9 | Same | Not addressed |
| Reviewability | High per slice | Low | High |
| Total calendar time | Longer but steady | Short burst, high risk | Fastest, incomplete |
| CLI surface | Subcommand-only (breaking) | Dual pattern (partial) | Unchanged mega-switches |

**What A gives up:** Does not introduce typed table accessors or a command framework; handwritten enum helpers remain (with drift tests).

**Edge cases:** All six command groups convert to subcommands with no backward compat shims — docs/skills must update in the same change. Decoder gitignore means local dev fails without generation — build hook required. Daemon extraction must preserve JSONL event names for harness consumers.

**Future flexibility:** Thin daemon modules and typed errors make harness/reconnect testing routine; canonical connection helper prevents new commands from reintroducing host/module bugs.
