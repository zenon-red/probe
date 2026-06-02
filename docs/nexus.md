# Nexus Daemon

`probe nexus run` keeps the authenticated identity online, sends heartbeats for registered agents, and emits machine-parseable lifecycle events for Nexus/SpacetimeDB.

## Usage

```bash
probe nexus run [--wallet <name>] [--log-level critical|info|debug] [--log-file <path>] [--replay <jsonl>]
probe nexus tui --wallet <name>
probe nexus status --wallet <name> [--format text|json|summary] [--action <id>] [--history] [--watch]
probe nexus   # attach to a running daemon when possible; otherwise start one
```

`probe nexus status` reads local audit files and action sidecars. Dispatch state uses live config when available.

## Output Contract

- `stdout` (`run`): structured JSONL events when stdout is being captured or `--json` is set
- `stderr` (`run`, when TTY): Ink dashboard; otherwise errors only

This split is intentional so agents can parse `stdout` safely.

## Log Levels

- `critical` (default): connection lifecycle + authentication + heartbeat health
- `info`: critical events plus heartbeat lifecycle events
- `debug`: info events plus full table insert/update/delete payloads, plus `harness_usage_extraction_failed` when token extraction returns `0`/`0` due to a detectable failure (stable `reason` field)

## Token telemetry

After each harness run, the daemon reports `input_tokens` / `output_tokens` on the action row. Use the **Node** `probe` binary for `probe nexus` (not `bun run` on source): Hermes reads `~/.hermes/state.db` via `node:sqlite` (requires Node ≥22.13). Failures are non-fatal — the action still completes and tokens are stored as `0`/`0`.

At `--log-level debug`, stdout may include:

```json
{
  "type": "harness_usage_extraction_failed",
  "source": "nexus",
  "at": "2026-05-23T22:30:00.000Z",
  "action_id": 123,
  "harness": "hermes",
  "reason": "sqlite_unavailable"
}
```

Common `reason` values: `sqlite_unavailable`, `hermes_state_db_missing`, `hermes_session_not_found`, `hermes_ambiguous_session`, `hermes_session_totals_missing`, `artifact_not_found`, `extraction_error`.

Hermes reads `~/.hermes/state.db` once per action (no directory scan). Correlation uses `messages.timestamp >= runStartedAt` (Unix seconds), not `state.db` file mtime.

## Critical Event Types

- `connected`
- `ready`
- `disconnected`
- `reconnecting`
- `reconnected`
- `subscription_applied`
- `subscription_error`
- `auth_failed`
- `heartbeat_failed`
- `heartbeat_recovered`
- `shutdown`

## Event Examples

Connected:

```json
{
  "type": "connected",
  "source": "nexus",
  "at": "2026-02-20T01:30:00.000Z",
  "identity": "...",
  "wallet": "agent-wallet",
  "host": "wss://db.zenon.red",
  "module": "nexus"
}
```

Disconnected + reconnecting:

```json
{"type":"disconnected","source":"nexus","at":"2026-02-20T01:42:11.000Z","reason":"disconnected","details":[{"message":"socket closed"}]}
{"type":"reconnecting","source":"nexus","at":"2026-02-20T01:42:12.000Z","attempt":3,"backoff_ms":4000}
```

Reconnected:

```json
{
  "type": "reconnected",
  "source": "nexus",
  "at": "2026-02-20T01:42:16.000Z",
  "attempts": 3,
  "downtime_ms": 5200,
  "identity": "..."
}
```

## Heartbeat Behavior

When the current identity maps to a registered agent, the daemon calls:

```typescript
callReducer(ctx, "heartbeat", { agentId: currentAgent.id });
```

- heartbeat interval: about every 60 seconds (+/-5 seconds jitter)
- after repeated heartbeat failures, daemon emits `heartbeat_failed`, marks session disconnected, and reconnects

## Debug Table Events

`--log-level debug` enables table CDC events:

- `table_insert`
- `table_update`
- `table_delete`

## File Logging

`--log-file <path>` appends the same JSONL events written to `stdout`.

Per wallet, Probe also writes:

- `~/.probe/audit/nexus/<wallet>/nexus.jsonl`
- `~/.probe/audit/nexus/<wallet>/actions/<id>.json`

Use `probe nexus status` to inspect this data without tailing JSONL by hand.

## Monitoring Examples

Filter critical failures:

```bash
probe nexus run | jq -c 'select(.type == "disconnected" or .type == "auth_failed" or .type == "heartbeat_failed")'
```

## Implementation

Source: `src/commands/nexus/run.ts`
