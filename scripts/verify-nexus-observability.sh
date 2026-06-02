#!/usr/bin/env bash
set -euo pipefail
# Non-TTY contract check for Codex-like agents.
WALLET="${PROBE_VERIFY_WALLET:-}"
LOG_FILE="${PROBE_VERIFY_LOG_FILE:-}"
if [[ -z "$WALLET" || -z "$LOG_FILE" ]]; then
  echo "Set PROBE_VERIFY_WALLET and PROBE_VERIFY_LOG_FILE" >&2
  exit 1
fi
if [[ ! -f "$LOG_FILE" ]]; then
  echo "Log file not found: $LOG_FILE" >&2
  exit 1
fi

probe nexus status --wallet "$WALLET" --log-file "$LOG_FILE" --format json >/tmp/nexus-status.json
probe nexus status --wallet "$WALLET" --log-file "$LOG_FILE" --history --limit 5 --format json >/tmp/nexus-history.json

node -e "
const fs = require('fs');
const status = JSON.parse(fs.readFileSync('/tmp/nexus-status.json', 'utf8'));
const history = JSON.parse(fs.readFileSync('/tmp/nexus-history.json', 'utf8'));
if (status.schema !== 'nexus.status.v1') process.exit(2);
if (!Array.isArray(history.events)) process.exit(3);
if (history.events.length > 5) process.exit(4);
console.log(JSON.stringify({ ok: true, dispatch: status.dispatch, actions: status.actions?.length ?? 0 }));
"

# Optional: first action sidecar id from JSONL
ACTION_ID="$(grep -o '"action_id":"[0-9]*"' "$LOG_FILE" | head -1 | sed 's/.*"\([0-9]*\)"/\1/' || true)"
if [[ -n "$ACTION_ID" ]]; then
  probe nexus status --wallet "$WALLET" --log-file "$LOG_FILE" --action "$ACTION_ID" --format json >/tmp/nexus-action.json
  node -e "
const a = JSON.parse(require('fs').readFileSync('/tmp/nexus-action.json','utf8'));
if (!a.action?.actionId) process.exit(5);
"
fi

echo "nexus observability verify: ok"
