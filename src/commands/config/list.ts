import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { errorMessage } from "~/utils/errors.js";
import { listConfigValues } from "./shared.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List merged config and user overrides",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (forceHelpRequested()) {
      printHelp({
        command: "probe config list",
        description: "List merged configuration and user overrides",
        usage: ["probe config list"],
      });
      return;
    }

    try {
      success(await listConfigValues());
    } catch (err) {
      error("CONFIG_ERROR", errorMessage(err, "Configuration error"));
    }
  },
});
