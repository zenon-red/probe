import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentAction } from "~/utils/context.js";
import { completionPolicyForRoute } from "~/utils/action-completion.js";
import { enumName } from "~/utils/enums.js";
import { callReducer } from "~/utils/context.js";
import { assertBoundActionId, withNexusMcpContext } from "./nexus-context.js";

const actionIdSchema = z.object({
  action_id: z.string().regex(/^\d+$/),
});

function parseActionId(raw: string): bigint {
  return BigInt(raw);
}

function findAction(ctx: { agentActions: AgentAction[] }, actionId: bigint): AgentAction {
  const action = ctx.agentActions.find((row) => row.id === actionId);
  if (!action) {
    throw new Error(`Action ${actionId} not found`);
  }
  return action;
}

async function runTool<T>(
  run: () => Promise<T>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const result = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
    };
  }
}

export function registerNexusMcpTools(server: McpServer): void {
  server.registerTool(
    "nexus_action_show",
    {
      description: "Show the bound agent action row",
      inputSchema: actionIdSchema,
    },
    async ({ action_id }) =>
      runTool(async () =>
        withNexusMcpContext(async (ctx, boundId) => {
          const actionId = parseActionId(action_id);
          assertBoundActionId(actionId);
          const action = findAction(ctx, actionId);
          return {
            ok: true,
            id: action.id.toString(),
            route: enumName(action.route),
            status: enumName(action.status),
          };
        }),
      ),
  );

  server.registerTool(
    "nexus_action_complete",
    {
      description: "Mark the bound action completed (generic routes only)",
      inputSchema: actionIdSchema,
    },
    async ({ action_id }) =>
      runTool(async () =>
        withNexusMcpContext(async (ctx, boundId) => {
          const actionId = parseActionId(action_id);
          assertBoundActionId(actionId);
          const action = findAction(ctx, actionId);
          const route = enumName(action.route);
          if (!completionPolicyForRoute(route).genericAllowed) {
            throw new Error(`Route ${route} requires a route-specific completion tool`);
          }
          await callReducer(ctx, ctx.conn.reducers.updateAgentAction, {
            actionId,
            eventType: { tag: "Completed" },
            eventCode: undefined,
            note: undefined,
          });
          return { ok: true, status: "completed", bound: boundId.toString() };
        }),
      ),
  );

  server.registerTool(
    "nexus_action_fail",
    {
      description: "Mark the bound action failed",
      inputSchema: actionIdSchema.extend({ reason: z.string().min(1) }),
    },
    async ({ action_id, reason }) =>
      runTool(async () =>
        withNexusMcpContext(async (ctx, boundId) => {
          const actionId = parseActionId(action_id);
          assertBoundActionId(actionId);
          await callReducer(ctx, ctx.conn.reducers.updateAgentAction, {
            actionId,
            eventType: { tag: "Failed" },
            eventCode: "mcp_fail",
            note: reason,
          });
          return { ok: true, status: "failed", bound: boundId.toString() };
        }),
      ),
  );

  server.registerTool(
    "nexus_action_skip",
    {
      description: "Mark the bound action skipped",
      inputSchema: actionIdSchema.extend({ reason: z.string().min(1) }),
    },
    async ({ action_id, reason }) =>
      runTool(async () =>
        withNexusMcpContext(async (ctx, boundId) => {
          const actionId = parseActionId(action_id);
          assertBoundActionId(actionId);
          await callReducer(ctx, ctx.conn.reducers.updateAgentAction, {
            actionId,
            eventType: { tag: "Skipped" },
            eventCode: "mcp_skip",
            note: reason,
          });
          return { ok: true, status: "skipped", bound: boundId.toString() };
        }),
      ),
  );
}
