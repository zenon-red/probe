import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { errorMessage } from "~/utils/errors.js";
import { VALID_CONFIG_KEYS, writeConfigValue } from "./shared.js";

export default defineCommand({
  meta: {
    name: "set",
    description: "Set one config value",
  },
  args: {
    key: {
      type: "positional",
      description: "Configuration key",
      required: false,
    },
    value: {
      type: "positional",
      description: "Configuration value",
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

    if (forceHelpRequested() || !args.key || args.value === undefined) {
      printHelp({
        command: "probe config set",
        description: "Set one configuration value",
        usage: [
          "probe config set <key> <value>",
          "probe config set defaultWallet agent-wallet",
          "probe config set autoUpdate notify",
        ],
        notes: [`Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`],
      });
      return;
    }

    try {
      const parsedValue = await writeConfigValue(args.key, args.value);
      success({ [args.key]: parsedValue });
    } catch (err) {
      error("CONFIG_ERROR", errorMessage(err, "Configuration error"));
    }
  },
});
