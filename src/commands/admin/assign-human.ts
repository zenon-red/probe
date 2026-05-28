import { defineCommand } from "citty";
import { applyJsonMode, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { parseTargetIdentityHex, runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: {
    name: "assign-human",
    description: "Assign Human role to a SpacetimeDB identity (caller must have Human role)",
  },
  args: {
    identity: {
      type: "positional",
      name: "identity",
      description: "Target identity (64-char hex)",
      required: true,
    },
    wallet: { type: "string", description: "Wallet name (must have Human role)" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const targetIdentity = parseTargetIdentityHex(String(args.identity));

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.assignHumanRole,
        params: { targetIdentity },
      });
      success({
        human_role_assigned: true,
        identity: targetIdentity.toHexString(),
      });
    });
  },
});
