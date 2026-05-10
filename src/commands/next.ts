import { defineCommand } from "citty";
import { checkAutoUpdateInBackground } from "~/utils/auto-update.js";
import { callReducer, type Agent, withAuth } from "~/utils/context.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { runHealthChecks, type HealthCheck } from "~/utils/health.js";
import { chooseNext, REASON_CODES, type NextAction } from "~/utils/next-router.js";
import { buildContextCommands, getNextActionDef } from "~/utils/next-action-defs.js";
import { toonList } from "~/utils/toon.js";

interface NextResult {
  action: NextAction;
  contextCommands: string[];
  completion: { taskInstruction: string; maxActions: number };
  health: HealthCheck[];
}

export default defineCommand({
  meta: {
    name: "next",
    description: "Deterministic router returning one bounded next action",
  },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);

    if (forceHelpRequested()) {
      printHelp({
        command: "probe next",
        description: "Return one bounded next action for a scheduled wake",
        usage: ["probe next", "probe next --json", "probe next --wallet my-wallet"],
        options: [
          { name: "--wallet", detail: "Wallet override" },
          { name: "--host, --module", detail: "SpacetimeDB overrides" },
          { name: "--json", detail: "JSON output" },
        ],
      });
      return;
    }

    // 1. Health check
    const health = await runHealthChecks({
      wallet: args.wallet,
      host: args.host,
      module: args.module,
      includeAgent: true,
    });

    // If critical health failures, return repair
    if (!health.ok || !health.agent) {
      const reason = !health.walletName
        ? REASON_CODES.REPAIR_WALLET
        : !health.tokenValid
          ? REASON_CODES.REPAIR_AUTH
          : !health.agent
            ? REASON_CODES.REPAIR_REGISTRATION
            : REASON_CODES.REPAIR_NEXUS;
      return emit({
        action: {
          kind: "repair",
          reason_code: reason,
          skill: "zr-doctor",
        },
        contextCommands: ["probe doctor"],
        completion: {
          ...getNextActionDef("repair"),
        },
        health: health.checks,
      });
    }

    const agent = health.agent;
    const walletName = health.walletName!;

    // 2. Connect and heartbeat
    await withAuth({ wallet: walletName, host: args.host, module: args.module }, async (ctx) => {
      // Heartbeat
      try {
        await callReducer(ctx, "heartbeat", { agentId: agent.id });
      } catch {
        // non-fatal
      }

      // Stale-state guard
      const agents = ctx.iter<Agent>("agents");
      if (agents.length === 0) {
        return emit({
          action: {
            kind: "repair",
            reason_code: REASON_CODES.REPAIR_EMPTY_SUBSCRIPTION,
            skill: "zr-doctor",
          },
          contextCommands: ["probe doctor"],
          completion: {
            ...getNextActionDef("repair"),
          },
          health: health.checks,
        });
      }

      const action = chooseNext(ctx, agent);

      // Persist action if not idle/repair
      if (action.kind !== "idle" && action.kind !== "repair") {
        try {
          await callReducer(ctx, "issue_agent_action", {
            agentId: agent.id,
            kind: action.kind,
            targetType: action.target?.type,
            targetId: action.target?.id,
            reasonCode: action.reason_code,
          });
        } catch {
          // non-fatal
        }
      }

      const contextCommands = buildContextCommands(action, agent.id);

      const actionDef = getNextActionDef(action.kind);

      emit({
        action: {
          kind: action.kind,
          target: action.target,
          reason_code: action.reason_code,
          skill: action.skill,
        },
        contextCommands,
        completion: {
          taskInstruction: actionDef.taskInstruction,
          maxActions: actionDef.maxActions,
        },
        health: health.checks,
      });
    });

    checkAutoUpdateInBackground();

    function emit(result: NextResult) {
      if (isJsonMode()) {
        const record: Record<string, string> = {};
        for (const c of result.health) {
          record[c.check] = c.status;
        }
        success({ ...result, health: record });
        return;
      }

      success(result);
      const targetType = result.action.target?.type || "";
      const targetId = result.action.target?.id || "";

      console.log(
        toonList("next_action", [
          {
            kind: result.action.kind,
            reason_code: result.action.reason_code,
            skill: result.action.skill || "",
            target_type: targetType,
            target_id: targetId,
            max_actions: result.completion.maxActions,
            task_instruction: result.completion.taskInstruction,
          },
        ]),
      );

      if (result.contextCommands.length > 0) {
        console.log(
          toonList(
            "context_commands",
            result.contextCommands.map((cmd) => ({ command: cmd })),
          ),
        );
      }
    }
  },
});
