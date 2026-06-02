import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyDoctorFixes, buildDoctorNextCommands } from "~/utils/doctor-issues.js";
import { exitProcess } from "~/utils/boundary.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import { runHealthChecks } from "~/utils/health.js";
import { getConfig } from "~/utils/config.js";
import { runAcpDoctor } from "~/acp/doctor.js";
import {
  installAdapterFromMetadata,
  isAdapterHarness,
  resolveAdapterMetadata,
} from "~/acp/agents/adapter-registry.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    fix: {
      type: "boolean",
      description:
        "Apply safe automated fixes (mkdir, clear expired token, set single default wallet)",
      default: false,
    },
    "no-agent": {
      type: "boolean",
      description: "Skip agent registration check",
      default: false,
    },
    install: {
      type: "boolean",
      description: "Install missing ACP adapter from registry metadata",
      default: false,
    },
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
        command: "probe doctor",
        description: "Validate Probe config, auth, Nexus connectivity, and agent registration",
        usage: [
          "probe doctor",
          "probe doctor --fix",
          "probe doctor --wallet my-wallet --host ws://127.0.0.1:3000 --module nexus",
        ],
        options: [
          { name: "--wallet", detail: "Wallet override for auth checks" },
          { name: "--host, --module", detail: "SpacetimeDB overrides" },
          {
            name: "--fix",
            detail:
              "Apply safe fixes: create writable dirs, clear expired token, set default wallet when only one exists",
          },
          { name: "--no-agent", detail: "Skip agent registration check (included by default)" },
          { name: "--json", detail: "JSON output mode" },
        ],
        notes: [
          "Primary output is data.issues[] with stable codes for automation.",
          "--fix never prompts and never mutates secrets; other issues include fix_command recommendations.",
        ],
      });
      return;
    }

    let fixed: Awaited<ReturnType<typeof applyDoctorFixes>> = [];

    if (args.fix) {
      const initial = await runHealthChecks({
        wallet: args.wallet,
        host: args.host,
        module: args.module,
        includeAgent: !args["no-agent"],
      });
      fixed = await applyDoctorFixes(initial.issues, {
        walletName: initial.walletName,
        walletDir: initial.walletDir,
        tokenCacheDir: initial.tokenCacheDir,
      });
    }

    if (args.install) {
      const cfg = await getConfig();
      const harness = cfg.harness;
      if (!harness || !isAdapterHarness(harness)) {
        error("ARGS_INVALID", "--install requires harness claude, codex, or pi in config");
      }
      const adapterHarness = harness;
      const metadata = await resolveAdapterMetadata(adapterHarness);
      const cmd = await installAdapterFromMetadata(metadata);
      await execFileAsync(cmd.command, cmd.args, { timeout: 120_000 });
      success({
        ok: true,
        installed: adapterHarness,
        registry_id: metadata.registryId,
        version: metadata.version,
        command: `${cmd.command} ${cmd.args.join(" ")}`,
      });
      return;
    }

    const cfg = await getConfig();
    const acpReport = await runAcpDoctor({
      harness: cfg.harness,
      harnessCommand: cfg.harnessCommand,
    });

    const result = await runHealthChecks({
      wallet: args.wallet,
      host: args.host,
      module: args.module,
      includeAgent: !args["no-agent"],
    });

    const { ok, counts, issues, walletName } = result;
    success(
      {
        ok,
        counts,
        issues,
        acp: acpReport,
        ...(fixed.length > 0 ? { fixed } : {}),
      },
      buildDoctorNextCommands(issues, walletName),
    );

    if (!ok) {
      exitProcess(1);
    }
  },
});
