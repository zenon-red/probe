# ACP ↔ acpx port map (Phase 0 gate)

Mandatory reference before probe ACP implementation. **Do not start Phase 1** until this document is reviewed and the spike checklist is signed off.

| Field             | Value                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| Reference repo    | [openclaw/acpx](https://github.com/openclaw/acpx)                                                       |
| Local path        | `~/research/acpx`                                                                                       |
| Pinned commit     | `f6de6dd18aae2945a5b63c76fe6e0daf1b04417b` (`feat(runtime): surface usage and command status metadata`) |
| acpx version      | `0.10.0`                                                                                                |
| SDK (align probe) | `@agentclientprotocol/sdk` `^0.22.1`                                                                    |
| License           | MIT (attribution on ported slices)                                                                      |
| PRD               | Archived — OpenSpec change `acp-harness-integration`                                                    |

### Probe–nexus delivery (2026-05-29)

| Surface                 | Location                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| ACP session + telemetry | `probe/src/acp/*`                                                         |
| probe-nexus MCP (stdio) | `probe mcp serve`, `probe/src/mcp/*`                                      |
| STDB columns + reducers | `nexus/stdb` (`token_source`, tool metrics, `report_action_run_progress`) |
| Lab token assert        | `nexus/lab/scripts/assert-tokens.sh` (STDB-only)                          |

---

## Dependency source (opensrc)

Resolve before reading adapter internals or pinning probe deps:

```bash
cd probe
opensrc path --cwd . npm:@agentclientprotocol/sdk
opensrc path --cwd . npm:@agentclientprotocol/codex-acp
opensrc path --cwd . npm:@agentclientprotocol/claude-agent-acp
```

| Package                                          | Cached path (2026-05-28)                                                  | Bin                | Underlying CLI                      |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------ | ----------------------------------- |
| `@agentclientprotocol/sdk` `^0.22.1`             | `~/.opensrc/repos/github.com/agentclientprotocol/typescript-sdk/0.22.1`   | —                  | —                                   |
| `@agentclientprotocol/codex-acp` `^0.0.44`       | `~/.opensrc/repos/github.com/agentclientprotocol/codex-acp/0.0.44`        | `codex-acp`        | `codex` (`CODEX_PATH`)              |
| `@agentclientprotocol/claude-agent-acp` `^0.37+` | `~/.opensrc/repos/github.com/agentclientprotocol/claude-agent-acp/0.38.0` | `claude-agent-acp` | `claude` (`CLAUDE_CODE_EXECUTABLE`) |

acpx spawn fallbacks (from `agent-registry.ts`): `npx -y @agentclientprotocol/codex-acp@^0.0.44`, `npx -y @agentclientprotocol/claude-agent-acp@^0.37.0`.

---

## Probe deltas (intentional)

| Topic                     | acpx                                        | probe nexus                                                           |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| **Default session**       | Persistent named sessions under `~/.acpx/`  | **Ephemeral** per `agent_actions` row                                 |
| **Selective persistence** | Same store for all sessions                 | **`ContinueOwnedTask` only** → `~/.probe/acp-sessions/` (probe-owned) |
| **`mcpServers`**          | Often runtime-global in `AcpRuntimeOptions` | **Per `session/new`**, per action (dynamic `PROBE_ACTION_ID`, etc.)   |
| **Orchestration**         | CLI, queue IPC, flows, multi-prompt queue   | STDB dispatch ticks, `reportActionRunFinished`                        |
| **Dependency**            | `acpx` package / CLI                        | **No acpx dep** — port patterns only                                  |

---

## Port matrix

| acpx source                                  | probe target                                           | Phase | Port?       | Notes                                                                                      |
| -------------------------------------------- | ------------------------------------------------------ | ----- | ----------- | ------------------------------------------------------------------------------------------ |
| `src/acp/client.ts`                          | `probe/src/acp/client.ts`, `connection.ts`             | 1     | partial     | Spawn, initialize, sessions, prompts, cancel. Skip vendor-specific timeouts unless needed. |
| `src/acp/client-process.ts`                  | `probe/src/acp/spawn.ts`                               | 1     | yes         | Stdio pipes, process lifecycle                                                             |
| `src/acp/error-normalization.ts`             | `probe/src/acp/errors.ts`                              | 1     | yes         | ACP errors → daemon / JSONL                                                                |
| `src/acp/agent-session-id.ts`                | `probe/src/acp/session-id.ts`                          | 4     | yes         | Reconcile ids on resume                                                                    |
| `src/acp/terminal-manager.ts`                | `probe/src/acp/terminal.ts`                            | 2–3   | conditional | If profile needs client terminals                                                          |
| `src/agent-registry.ts`                      | `probe/src/acp/agents/registry.ts`, `agents/launch.ts` | 1     | yes         | Matrix + `BUILT_IN_AGENT_PACKAGES` + `resolveInstalledBuiltInAgentLaunch`                  |
| `src/acp/agent-command.ts`                   | `probe/src/acp/agents/claude.ts`                       | 3     | yes         | Session create timeout, `claudeCode` `_meta`, executable resolve                           |
| `src/acp/codex-compat.ts`                    | `probe/src/acp/agents/codex.ts`                        | 3     | yes         | `isCodexAcpCommand`, legacy `@zed-industries/codex-acp` guard                              |
| `src/mcp-servers.ts`                         | `probe/src/mcp/bundle.ts`                              | 2     | yes         | Parse/build `McpServer` configs                                                            |
| `src/permissions.ts`, `permission-policy.ts` | `probe/src/acp/permissions.ts`                         | 1     | yes         | Unattended auto-allow; no TTY prompt                                                       |
| `src/filesystem.ts`                          | `probe/src/acp/filesystem.ts`                          | 1–2   | yes         | cwd-scoped fs callbacks                                                                    |
| `src/prompt-content.ts`                      | `probe/src/acp/prompt.ts`                              | 1     | patterns    | Dispatch prompt + `_meta`                                                                  |
| `src/runtime/engine/prompt-turn.ts`          | `probe/src/acp/outcome.ts`                             | 1     | yes         | stopReason + update drain                                                                  |
| `src/runtime/engine/reconnect.ts`            | `probe/src/acp/resume.ts`                              | 4     | selective   | resume → load fallback                                                                     |
| `src/runtime/engine/reuse-policy.ts`         | `probe/src/acp/resume.ts`                              | 4     | yes         | Handle reuse guards                                                                        |
| `src/runtime/engine/lifecycle.ts`            | `probe/src/acp/lifecycle.ts`                           | 4     | partial     | Reconnect snapshots                                                                        |
| `src/runtime/public/events.ts`               | `probe/src/acp/events.ts`                              | 1–2   | patterns    | session/update → JSONL                                                                     |
| `src/runtime/public/file-session-store.ts`   | `probe/src/acp/session-store.ts`                       | 4     | rewrite     | Probe schema, not `~/.acpx/`                                                               |
| `test/integration.test.ts`                   | `probe/tests/integration/acp/`                         | 1+    | patterns    | Mock agent smoke test                                                                      |

### Explicit non-ports

CLI, flows, queue IPC, `~/.acpx/` persistence, replay viewer, acpx runtime npm API.

### Probe-only (not acpx ports)

| probe target                 | Phase | Notes                                           |
| ---------------------------- | ----- | ----------------------------------------------- |
| `probe/src/acp/readiness.ts` | 1–3   | ACP readiness vs legacy CLI probes              |
| `probe/src/acp/doctor.ts`    | 1     | `probe acp doctor`                              |
| `probe/src/acp/setup.ts`     | 3     | `probe acp setup`; Hermes `[acp]` / credentials |
| Onboard `acp_readiness` step | 3     | After `configureHarness`                        |

---

## Bundled adapters (Zed / acpx parity)

Probe **`package.json` dependencies** (not devDependencies):

- `@agentclientprotocol/sdk` `^0.22.1`
- `@agentclientprotocol/claude-agent-acp` `^0.37.0`
- `@agentclientprotocol/codex-acp` `^0.0.44`

Spawn order (port `resolveInstalledBuiltInAgentLaunch`): **probe `node_modules` bin → PATH → `npx` last resort**.

Underlying `claude` / `codex` CLIs remain user-installed; Hermes needs `pip install 'hermes-agent[acp]'` + `hermes acp --check`.

---

## Session lifecycle

**Ephemeral (default, Phase 1):** spawn → initialize → session/new → prompt → close — one session per action row.

**Persistent (`ContinueOwnedTask`, Phase 4):** probe-owned handle in `~/.probe/acp-sessions/`; `session/resume` or `session/load` per tick; port `reconnect.ts` + `reuse-policy.ts`. **AssignOpenTask** stays ephemeral.

---

## zenon-red agent registry

| probe `HarnessType` | ACP spawn          | acpx key   | opensrc package                         |
| ------------------- | ------------------ | ---------- | --------------------------------------- |
| `opencode`          | `opencode acp`     | `opencode` | —                                       |
| `hermes`            | `hermes acp`       | —          | —                                       |
| `pi`                | `pi-acp`           | `pi`       | —                                       |
| `openclaw`          | `openclaw acp`     | `openclaw` | —                                       |
| `claude`            | `claude-agent-acp` | `claude`   | `@agentclientprotocol/claude-agent-acp` |
| `codex`             | `codex-acp`        | `codex`    | `@agentclientprotocol/codex-acp`        |

**Superseded:** `prd-probe-claude-codex-support.md` (CLI `claude -p` / `codex exec`) — deleted; use adapters above.

---

## Phase 0 spike checklist

- [ ] acpx at pinned SHA
- [ ] Trace client.ts: spawn → initialize → newSession → prompt
- [ ] Read reconnect.ts + permissions non-interactive path
- [ ] opensrc paths recorded for SDK + claude + codex adapters
- [ ] Skim `claude-agent-acp` + `codex-acp` `src/` (opensrc) and acpx `agent-command.ts` / `codex-compat.ts`
- [ ] **Verify `hermes acp`** — confirm binary exists in hermes-agent install, speaks ACP over stdio, emits usage. If unsupported, document and exclude from Phase 3.
- [ ] **Verify `pi-acp`** — confirm third-party adapter passes ACP conformance (run against opencode baseline test or equivalent). Check if it emits `usage_update`.
- [ ] **Verify `opencode acp`** — confirmed via docs; run `opencode acp` locally to validate initialize handshake.
- [ ] **Clone opencode ACP source** — `~/research/opencode` for `packages/opencode/src/acp/` reference (listed in PRD references but not yet cloned)
- [ ] Sign-off Operator UX (bundled adapters, doctor codes, Hermes setup policy) with PRD § Operator UX
- [ ] Sign-off before Phase 1

---

## Changelog

| Date       | Change                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 2026-05-28 | Initial port map; pinned acpx f6de6dd                                                                   |
| 2026-05-28 | Claude + Codex adapters; opensrc paths; superseded CLI harness PRD                                      |
| 2026-05-29 | Added harness verification items to Phase 0 checklist (hermes, pi-acp, opencode, opencode source clone) |
| 2026-05-29 | Bundled adapters + launch resolver; doctor/setup modules; aligned with PRD § Operator UX                |
