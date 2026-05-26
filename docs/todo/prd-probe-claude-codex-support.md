# PRD: Claude Code and Codex CLI Harness Support

## Status

- Draft
- Owner: Probe maintainers
- Scope: `probe/src/daemon/harness-runner.ts`, `probe/src/utils/harness-detection.ts`, `probe/src/daemon/harness-usage/`
- Depends on: existing session-store token extraction architecture
- Related: Nexus lab harness audit mounts

## Context

Probe currently supports four harnesses: pi, hermes, opencode, openclaw. Claude Code (`claude`) and OpenAI Codex CLI (`codex`) are both well-documented, npm-installable, and have mature non-interactive modes with structured output and on-disk session persistence. Adding them to probe's harness detection and spawn system gives agents more runtime options and aligns the dev lab with a six-harness matrix.

Both are closed-source but npm-distributed — docs and CLI behavior are sufficient for integration.

## Harness Profiles

### Claude Code

| Property             | Value                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI package          | `@anthropic-ai/claude-code` (npm)                                                                                                                                                                                                                               |
| Binary               | `claude`                                                                                                                                                                                                                                                        |
| Auth                 | `ANTHROPIC_API_KEY` env var (required in bare mode)                                                                                                                                                                                                             |
| Non-interactive mode | `claude -p --dangerously-skip-permissions <prompt>`                                                                                                                                                                                                             |
| Flags of interest    | `-p` (print/non-interactive), `--dangerously-skip-permissions` (auto-approve tools in piped spawn). No `--bare` — skills/hooks/CLAUDE.md auto-discovery is needed for `zenon-red/skills`. No `--output-format json` — tokens read from session store post-exit. |
| Session storage      | `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`                                                                                                                                                                                                           |
| Session format       | JSONL — one JSON object per line, one line per conversation turn                                                                                                                                                                                                |
| Token fields         | Per assistant message in JSONL: `message.usage.input_tokens`, `message.usage.output_tokens`. Also present: `cache_creation_input_tokens`, `cache_read_input_tokens` (ignored per telemetry PRD).                                                                |
| Install              | `npm install -g @anthropic-ai/claude-code`                                                                                                                                                                                                                      |
| Known dir            | `~/.claude`                                                                                                                                                                                                                                                     |

### Codex CLI

| Property             | Value                                                                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI package          | `@openai/codex` (npm)                                                                                                                                                                                                                                                                               |
| Binary               | `codex`                                                                                                                                                                                                                                                                                             |
| Auth                 | `OPENAI_API_KEY` env var or `codex login --with-api-key`                                                                                                                                                                                                                                            |
| Non-interactive mode | `codex exec --full-auto <prompt>`                                                                                                                                                                                                                                                                   |
| Flags of interest    | `exec` (non-interactive subcommand), `--full-auto` (skip permission prompts for piped spawn). No `--json` — tokens read from session store post-exit.                                                                                                                                               |
| Session storage      | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`                                                                                                                                                                                                                                                      |
| Session format       | JSONL — full conversation history, tool calls, tool results                                                                                                                                                                                                                                         |
| Token fields         | `event_msg` lines where `payload.type === "token_count"`: `payload.info.total_token_usage.input_tokens`, `payload.info.total_token_usage.output_tokens`. Also present: `cached_input_tokens`, `reasoning_output_tokens` (ignored per telemetry PRD). Not on stdout — only in session JSONL on disk. |
| Install              | `npm install -g @openai/codex`                                                                                                                                                                                                                                                                      |
| Known dir            | `~/.codex`                                                                                                                                                                                                                                                                                          |

## Probe Changes

### 1. Harness Detection (`harness-detection.ts`)

Add two entries to `HARNESS_PROBES`:

```typescript
{
  id: "claude",
  pathCheck: "claude",
  knownDir: join(homedir(), ".claude"),
  command: "claude",
  preArgs: ["-p", "--dangerously-skip-permissions"],
},
{
  id: "codex",
  pathCheck: "codex",
  knownDir: join(homedir(), ".codex"),
  command: "codex",
  preArgs: ["exec", "--full-auto"],
},
```

Update the `NOTE` comment to reflect 6 harnesses.

Update `HarnessType` in `probe/src/types/config.ts` to include `"claude"` and `"codex"`.

### 2. Harness Spawn (`harness-runner.ts`)

Add entries in `buildHarnessSpawnArgs`:

```typescript
if (harness.harness === "claude") return ["claude", "-p", "--dangerously-skip-permissions", prompt];
if (harness.harness === "codex") return ["codex", "exec", "--full-auto", prompt];
```

No change to `runHarness` signature — `stdio: "pipe"` is sufficient for both. Both emit structured output to stdout and persist sessions to disk independently.

### 3. Token Extraction (`daemon/harness-usage/`)

Add parsers for claude and codex session stores:

**Claude:** Read JSONL from `~/.claude/projects/<encoded-cwd>/`. For the session containing `zenon.red{action:<id>}`, parse each line with `type === "assistant"` and sum `message.usage.input_tokens` + `message.usage.output_tokens`. Ignore `cache_creation_input_tokens` and `cache_read_input_tokens`. `<encoded-cwd>` is the URL-encoded form of the working directory at spawn time (the daemon's cwd).

**Codex:** Read JSONL from `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Given action run timestamp, find session files from matching date directory. Filter lines where `payload.type === "token_count"`. The last such event in the session carries cumulative totals: sum `payload.info.total_token_usage.input_tokens` + `payload.info.total_token_usage.output_tokens`. Ignore `cached_input_tokens` and `reasoning_output_tokens`. Do not parse stdout — token count events in codex's stdout JSONL stream (`--json` flag) are cumulative deltas; the on-disk session file gives final totals in one read.

### 4. Documentation

Update `probe/docs/commands.md` — add claude and codex to the `--harness` description.

## Correlation

Both harnesses receive the same prompt format via `buildActionPrompt()`. The first line `zenon.red{action:<id>}` is stored in the first user message of each session. Same grep strategy as existing harnesses:

```bash
grep -rlF 'zenon.red{action:42}' ~/.claude/projects/
grep -rlF 'zenon.red{action:42}' ~/.codex/sessions/
```

No probe changes needed for lab audit — Docker mounts of `~/.claude` and `~/.codex` cover it.

## LLM Key Handling

Both harnesses require a single API key env var — simpler than hermes (which may have provider/model config). Docker images and `compose.agents.yml` inject:

- `ANTHROPIC_API_KEY` for claude containers
- `OPENAI_API_KEY` for codex containers

Probe does not manage keys — the agent operator configures them.

## Risks and Mitigations

| Risk                                                                  | Mitigation                                                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Claude headless mode may strip context that interactive mode provides | The `-p` prompt carries all needed instruction and skills remain discoverable from the working tree/global install.                       |
| Codex `--full-auto` may behave differently across versions            | Pin codex version in Docker image. Test with one real action before general rollout.                                                      |
| Codex token field names undocumented                                  | Run `codex exec --json` with a simple prompt, inspect `~/.codex/sessions/` JSONL output, document fields.                                 |
| Claude CWD encoding for session path                                  | `~/.claude/projects/` uses URL-encoded cwd. Probe daemon cwd is known at spawn. Same cwd per agent (container working dir).               |
| Both are closed-source — behavior could change                        | Docs are public and actively maintained. CLI flags (`-p`, `--dangerously-skip-permissions`, `exec`, `--full-auto`) are stable interfaces. |

## Implementation Phases

### Phase 1: Detection + Spawn

- Add `HARNESS_PROBES` entries for claude and codex
- Add `buildHarnessSpawnArgs` entries
- Update `HarnessType` union
- Smoke test: `probe nexus --harness claude --wallet <test>` and `--harness codex`

### Phase 2: Token Extraction

- Add claude session store parser under `daemon/harness-usage/`
- Add codex session store parser under `daemon/harness-usage/`
- Unit tests with fixture JSONL from real runs

### Phase 3: Documentation

- Update `probe/docs/commands.md`
- Add harness notes to `nexus/dev/harnesses/claude.md`, `nexus/dev/harnesses/codex.md`

## Acceptance Criteria

- `probe nexus --harness claude` spawns `claude -p --dangerously-skip-permissions <prompt>` and runs to completion
- `probe nexus --harness codex` spawns `codex exec --full-auto <prompt>` and runs to completion
- Harness detection discovers claude and codex when installed
- Session correlation via `grep -rF 'zenon.red{action:N}'` works against both `~/.claude/projects/` and `~/.codex/sessions/`
- Token counts extractable from session stores (telemetry PRD phase)

## References

- Claude Code headless mode: https://code.claude.com/docs/en/headless
- Claude Code session storage: https://code.claude.com/docs/en/agent-sdk/sessions
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Codex CLI cheat sheet: https://computingforgeeks.com/codex-cli-cheat-sheet/
- Codex CLI exec mode: https://developers.openai.com/codex/cli/reference
- Codex headless tracking issue: https://github.com/openai/codex/issues/4219
- Probe harness-runner: `probe/src/daemon/harness-runner.ts`
- Probe harness-detection: `probe/src/utils/harness-detection.ts`
