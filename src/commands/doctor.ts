import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { isJsonMode, setJsonMode, success } from "~/utils/output.js";
import { runHealthChecks } from "~/utils/health.js";
import { toonList } from "~/utils/toon.js";

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Run environment and connectivity diagnostics",
  },
  args: {
    wallet: {
      type: "string",
      description: "Wallet name override for auth checks",
    },
    host: {
      type: "string",
      description: "SpacetimeDB host override",
    },
    module: {
      type: "string",
      description: "SpacetimeDB module override",
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
  },
  async run({ args }) {
    if (args.json) {
      setJsonMode(true);
    }

    if (forceHelpRequested()) {
      printHelp({
        command: "probe doctor",
        description: "Validate Probe config, auth, and Nexus connectivity",
        usage: [
          "probe doctor",
          "probe doctor --wallet my-wallet --host ws://127.0.0.1:3000 --module nexus",
        ],
        options: [
          { name: "--wallet", detail: "Wallet override for auth checks" },
          { name: "--host, --module", detail: "SpacetimeDB overrides" },
          { name: "--json", detail: "JSON output mode" },
        ],
      });
      return;
    }

    const result = await runHealthChecks({
      wallet: args.wallet,
      host: args.host,
      module: args.module,
      includeAgent: false,
    });

    const { ok, counts, checks } = result;
    success({ ok, counts, checks });

    if (!isJsonMode()) {
      console.log(toonList("doctor_checks", checks));
      console.log(toonList("doctor_summary", [{ ok, ...counts }]));
    }
  },
});
