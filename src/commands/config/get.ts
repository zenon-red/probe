import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { errorMessage } from "~/utils/errors.js";
import { readConfigValue, VALID_CONFIG_KEYS } from "./shared.js";

export default defineCommand({
  meta: {
    name: "get",
    description: "Get one config value",
  },
  args: {
    key: {
      type: "positional",
      description: "Configuration key",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (forceHelpRequested() || !args.key) {
      printHelp({
        command: "probe config get",
        description: "Get one configuration value",
        usage: ["probe config get <key>", "probe config get spacetime.host"],
        notes: [`Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`],
      });
      return;
    }

    try {
      const value = await readConfigValue(args.key);
      success({ [args.key]: value });
    } catch (err) {
      error("CONFIG_ERROR", errorMessage(err, "Configuration error"));
    }
  },
});
