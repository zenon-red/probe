import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerNexusMcpTools } from "./nexus-tools.js";

export async function runMcpServe(): Promise<void> {
  const server = new McpServer(
    {
      name: "probe-nexus",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Nexus action completion tools for ACP sessions. action_id must match PROBE_ACTION_ID.",
    },
  );

  registerNexusMcpTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
