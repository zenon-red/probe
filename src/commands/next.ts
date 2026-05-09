import { defineCommand } from "citty";
import { log } from "@clack/prompts";
import { checkAutoUpdateInBackground } from "~/utils/auto-update.js";
import { callReducer, type Agent, withAuth } from "~/utils/context.js";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { isJsonMode, note, setJsonMode, success } from "~/utils/output.js";
import { runHealthChecks, type HealthCheck } from "~/utils/health.js";
import { chooseNext, REASON_CODES, type NextAction } from "~/utils/next-router.js";

interface NextResult {
  action: NextAction;
  contextCommands: string[];
  completion: { instruction: string; maxActions: number };
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
          instruction: "Complete the routed action.",
          maxActions: 1,
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
            instruction: "Complete the routed action.",
            maxActions: 1,
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
            leaseExpiresAt: undefined,
          });
        } catch {
          // non-fatal
        }
      }

      const contextCommands: string[] = [];
      if (action.target?.type === "idea") {
        contextCommands.push(`probe idea get ${action.target.id}`);
        contextCommands.push("probe idea dimensions");
      }
      if (action.target?.type === "task") {
        contextCommands.push(`probe task get ${action.target.id}`);
      }
      if (action.target?.type === "message") {
        contextCommands.push(`probe message list ${agent.id} --limit 10`);
      }
      if (action.target?.type === "directive") {
        contextCommands.push("probe message directives general --limit 1");
      }
      if (action.target?.type === "project") {
        contextCommands.push(`probe project get ${action.target.id}`);
      }
      if (action.target?.type === "discovered_task") {
        contextCommands.push(`probe discover get ${action.target.id}`);
      }

      emit({
        action: {
          kind: action.kind,
          target: action.target,
          reason_code: action.reason_code,
          skill: action.skill,
        },
        contextCommands,
        completion: {
          instruction: "Complete the routed action.",
          maxActions: 1,
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

      const { action } = result;
      const displayNames: Record<string, string> = {
        propose: "Propose an Idea",
        vote: "Vote on Ideas",
        claim_task: "Claim a Task",
        continue_task: "Continue Task",
        inbox: "Check Inbox",
        project_setup: "Set Up Project",
        create_tasks: "Create Tasks",
        validate_reviews: "Validate Reviews",
        review_discovery: "Review Discovery",
        repair: "Repair",
        idle: "Idle",
      };
      const displayName =
        action.reason_code === REASON_CODES.READ_DIRECTIVE
          ? "Read Directive"
          : displayNames[action.kind] || action.kind;

      log.step(`NEXT ACTION: ${displayName.toUpperCase()}`);

      if (action.skill) {
        note(
          `Load and follow the skill ${action.skill} to the best of your abilities.`,
          "Instructions",
        );
      }

      if (result.contextCommands.length > 0) {
        for (const cmd of result.contextCommands) {
          log.info(cmd);
        }
      }

      if (action.kind === "repair") {
        const failed = result.health.filter((c) => c.status === "fail" || c.status === "warn");
        if (failed.length > 0) {
          for (const c of failed) {
            log.error(`${c.check}: ${c.detail}`);
          }
        }
      }

      if (action.kind === "idle") {
        log.info("No pending work. All health checks pass.");
      }
    }
  },
});
