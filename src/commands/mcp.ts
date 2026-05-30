import { defineCommand } from "citty";
import { runMcpServe } from "~/mcp/serve.js";
import { renderBoundaryErrorAndExit } from "~/utils/boundary.js";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Model Context Protocol servers for ACP sessions",
  },
  subCommands: {
    serve: defineCommand({
      meta: {
        name: "serve",
        description: "stdio MCP server (probe-nexus tools)",
      },
      async run() {
        try {
          await runMcpServe();
        } catch (error) {
          renderBoundaryErrorAndExit(error);
        }
      },
    }),
  },
});
