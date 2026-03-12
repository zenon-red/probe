# Nexus Daemon

`probe nexus` runs a persistent keepalive process for Nexus/SpacetimeDB. It keeps the authenticated identity online, sends heartbeats for registered agents, and emits machine-parseable lifecycle events.

## Usage

```bash
probe nexus [--wallet <name>] [--log-level critical|info|debug] [--log-file <path>] [--pretty]
```

## Output Contract

- `stdout`: structured JSONL events only (one JSON object per line)
- `stderr`: optional human-readable logs when `--pretty` is enabled

This split is intentional so agents can parse `stdout` safely.

## Log Levels

- `critical` (default): connection lifecycle + authentication + heartbeat health
- `info`: critical events plus heartbeat lifecycle events
- `debug`: info events plus full table insert/update/delete payloads

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
{"type":"connected","source":"nexus","at":"2026-02-20T01:30:00.000Z","identity":"...","wallet":"agent-wallet","host":"wss://db.zenon.red","module":"nexus"}
```

Disconnected + reconnecting:

```json
{"type":"disconnected","source":"nexus","at":"2026-02-20T01:42:11.000Z","reason":"disconnected","details":[{"message":"socket closed"}]}
{"type":"reconnecting","source":"nexus","at":"2026-02-20T01:42:12.000Z","attempt":3,"backoff_ms":4000}
```

Reconnected:

```json
{"type":"reconnected","source":"nexus","at":"2026-02-20T01:42:16.000Z","attempts":3,"downtime_ms":5200,"identity":"..."}
```

## Heartbeat Behavior

When the current identity maps to a registered agent, the daemon calls:

```typescript
callReducer(ctx, 'heartbeat', { agentId: currentAgent.id });
```

- heartbeat interval: about every 60 seconds (+/-5 seconds jitter)
- after repeated heartbeat failures, daemon emits `heartbeat_failed`, marks session disconnected, and reconnects

## Debug Table Events

`--log-level debug` enables table CDC events:
- `table_insert`
- `table_update`
- `table_delete`

`--sender <id>` applies only to debug events for `messages` and `project_messages`.

## File Logging

`--log-file <path>` appends the same JSONL events written to `stdout`.

## Monitoring Examples

Filter critical failures:

```bash
probe nexus | jq -c 'select(.type == "disconnected" or .type == "auth_failed" or .type == "heartbeat_failed")'
```

Debug stream for one sender:

```bash
probe nexus --log-level debug --sender zoe-1
```

## Implementation

Source: `src/commands/nexus-daemon.ts`
