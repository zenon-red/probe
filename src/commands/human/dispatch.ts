import { defineCommand } from "citty";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { parseDispatchMode, runWithBoundary } from "./shared.js";
import { readDispatchEnabled } from "~/utils/dispatch-enabled.js";

export default defineCommand({
  meta: {
    name: "dispatch",
    description: "Module dispatch kill switch (Human role): on | off | status",
  },
  args: {
    mode: {
      type: "positional",
      name: "mode",
      description: "on | off | status",
      required: true,
    },
    wallet: { type: "string", description: "Wallet name (must have Human role)" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const mode = parseDispatchMode(String(args.mode));

    await runWithBoundary(async () => {
      if (mode === "status") {
        await withAuth(
          commandContextOptions(args, { subscribe: ["SELECT * FROM config"] }),
          async (ctx) => {
            const enabled = readDispatchEnabled(ctx.stdbConfig);
            success({
              dispatch_enabled: enabled,
              dispatch: enabled ? "on" : "off",
            });
          },
        );
        return;
      }

      const enabled = mode === "on";
      await runReducerCommand(args, {
        reducer: (ctx) => ctx.conn.reducers.setDispatchEnabled,
        params: { enabled },
      });
      success({
        dispatch_enabled: enabled,
        dispatch: enabled ? "on" : "off",
      });
    });
  },
});
