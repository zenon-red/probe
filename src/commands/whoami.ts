import { defineCommand } from "citty";
import { AGENT_SUBSCRIBE, commandContextOptions, withAuth } from "~/utils/context.js";
import { failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

export default defineCommand({
  meta: {
    name: "whoami",
    description: "Show current authenticated agent profile",
  },
  args: {
    wallet: { type: "string", description: "Wallet name" },
    json: { type: "boolean", description: "Output JSON", default: false },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
  },
  async run({ args }) {
    applyJsonMode(args);

    try {
      await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
        const myAgent = ctx.agents.find(
          (a) => a.identity.toHexString() === ctx.identity?.toHexString(),
        );

        if (!myAgent) {
          error("NOT_REGISTERED", "Agent not registered. Run `probe agent register` first.");
        }

        success({
          ...myAgent,
          identity: ctx.identity?.toHexString() || "",
        });
      });
    } catch (err) {
      failWithConnectionOrUnexpected(err);
    }
  },
});
