import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { error } from "~/utils/output.js";
import { getConfig } from "~/utils/config.js";
import {
  formatSummary,
  loadNexusStatus,
  loadNexusStatusHistory,
  renderStatusText,
} from "~/daemon/status-reader.js";
import { readActionSidecar } from "~/daemon/sidecar-read.js";
import { NEXUS_STATUS_SCHEMA } from "~/daemon/status-schema.js";

const HISTORY_DEFAULT_LIMIT = 25;
const HISTORY_MAX_LIMIT = 1000;

function parseFilter(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const match = /^type=(.+)$/.exec(value.trim());
  return match?.[1];
}

function parseLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return HISTORY_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), HISTORY_MAX_LIMIT);
}

export default defineCommand({
  meta: {
    name: "status",
    description: "Query Nexus daemon audit state (JSON, summary, or text)",
  },
  args: {
    wallet: { type: "string", description: "Wallet whose audit files to read" },
    host: { type: "string", description: "SpacetimeDB host override (metadata only)" },
    module: { type: "string", description: "SpacetimeDB module override (metadata only)" },
    harness: { type: "string", description: "Harness label (metadata only)" },
    "log-file": { type: "string", description: "JSONL audit path override" },
    format: {
      type: "string",
      description: "Output format: text (default), json, summary",
    },
    action: { type: "string", description: "Return enriched sidecar for action id" },
    history: { type: "boolean", description: "Return bounded JSONL history", default: false },
    filter: { type: "string", description: "History filter, e.g. type=action_failed_infra" },
    since: { type: "string", description: "History window, e.g. 5m, 1h" },
    limit: { type: "string", description: "History max events (default 25, cap 1000)" },
    watch: { type: "boolean", description: "Refresh status at a bounded interval", default: false },
    json: { type: "boolean", description: "JSON output mode", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    if (forceHelpRequested()) {
      printHelp({
        command: "probe nexus status",
        description: "Bounded auditor surface over daemon JSONL and action sidecars",
        usage: [
          "probe nexus status --wallet agent-wallet",
          "probe nexus status --wallet agent-wallet --format json",
          "probe nexus status --wallet agent-wallet --action 42 --format json",
          "probe nexus status --wallet agent-wallet --history --filter type=error --since 5m",
        ],
        options: [
          { name: "--wallet", detail: "Wallet whose ~/.probe/audit/nexus/<wallet>/ files to read" },
          { name: "--log-file", detail: "Override nexus.jsonl path" },
          { name: "--format", detail: "text | json | summary (default text)" },
          { name: "--action", detail: "Return actions/<id>.json sidecar as JSON" },
          { name: "--history", detail: "Bounded event history from JSONL" },
          { name: "--filter", detail: "History predicate, e.g. type=action_failed_infra" },
          { name: "--since", detail: "History time window: 30s, 5m, 1h, 1d" },
          {
            name: "--limit",
            detail: `Max events (default ${HISTORY_DEFAULT_LIMIT}, cap ${HISTORY_MAX_LIMIT})`,
          },
          {
            name: "--watch",
            detail: "Refresh using selected format (default text; use --format json for agents)",
          },
        ],
        notes: [
          "Reads durable local audit files. Dispatch uses JSONL module_dispatch events, or live config when connected.",
          `JSON responses include schema ${NEXUS_STATUS_SCHEMA}.`,
        ],
      });
      return;
    }

    const config = await getConfig();
    const wallet = (args.wallet as string | undefined) ?? config.defaultWallet;
    if (!wallet) {
      error("ARGS_REQUIRED", "--wallet is required (or set defaultWallet in config)");
    }

    const format = (args.format as string | undefined) ?? (args.json ? "json" : "text");

    const renderOnce = async (): Promise<void> => {
      if (args.action) {
        const action = await readActionSidecar(wallet, String(args.action));
        if (!action) {
          error("NOT_FOUND", `Unknown action: ${args.action}`);
        }
        const payload = { schema: NEXUS_STATUS_SCHEMA, action };
        if (format === "json" || args.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(JSON.stringify(action, null, 2));
        return;
      }

      if (args.history) {
        const payload = await loadNexusStatusHistory({
          wallet,
          logFile: args["log-file"] as string | undefined,
          filterType: parseFilter(args.filter),
          since: args.since as string | undefined,
          limit: parseLimit(args.limit),
        });
        if (format === "json" || args.json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        for (const event of payload.events) {
          console.log(`${event.at} ${event.type}`);
        }
        return;
      }

      const status = await loadNexusStatus({
        wallet,
        logFile: args["log-file"] as string | undefined,
        host: args.host as string | undefined,
        module: args.module as string | undefined,
        harness: args.harness as string | undefined,
        liveDispatch: true,
      });

      if (format === "json" || args.json) {
        success(status);
        return;
      }
      if (format === "summary") {
        const summary = formatSummary(status);
        console.log(summary);
        return;
      }
      console.log(renderStatusText(status));
    };

    await renderOnce();
    if (!args.watch) return;

    const intervalMs = format === "json" ? 2000 : 1000;
    const timer = setInterval(() => {
      void renderOnce();
    }, intervalMs);
    const stop = (): void => {
      clearInterval(timer);
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => {});
  },
});
