# OpenClaw + ACP (probe)

OpenClaw agents run through the `openclaw acp` adapter like other harnesses, but **probe does not attach per-session `mcpServers`** for OpenClaw. The ACP profile sets `supportsPerSessionMcp: false` because the gateway owns MCP configuration.

## Implications

- **probe-nexus MCP tools** (`nexus_action_show`, `nexus_action_complete`, etc.) are **not** injected on each dispatch session for OpenClaw.
- Completion for Nexus actions must use **CLI** (`probe action complete|fail|skip`) or **Gateway MCP** configured in OpenClaw, not the stdio `probe mcp serve` bundle.
- `probe acp doctor` reports `openclaw_gateway_mcp` as an informational issue when OpenClaw is selected.

## Operator setup

1. Configure OpenClaw Gateway MCP with the same Nexus/STDB credentials your wallet uses (`probe login`).
2. Ensure completion tools update the bound `agent_actions` row (or use CLI completion).
3. Run `probe acp doctor` after install to confirm `openclaw acp` initializes.

## Lab / telemetry

Token and tool metrics still flow from ACP `session/update` (usage + tool calls). Lab `assert-tokens.sh` reads STDB `token_source` on `agent_actions` — no harness session file scraping.
