import { defineCommand } from "citty";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import type { OnboardStep } from "~/utils/onboard/types.js";
import {
  applyGenesisStep,
  authenticateStep,
  configureDaemon,
  configureHarness,
  createWalletStep,
  ensureNexusLayout,
  installSkillsStep,
  registerAgentStep,
  resolveIdentity,
  runVerification,
  sendAnnouncement,
  setBioStep,
  setCapabilitiesStep,
  setDefaultWallet,
  verifyHome,
  verifyPasswordFile,
  type OnboardState,
} from "~/utils/onboard/steps.js";

export default defineCommand({
  meta: {
    name: "onboard",
    description: "Idempotent agent setup for wallet, auth, registration, and harness configuration",
  },
  args: {
    name: {
      type: "string",
      description: "Agent display name (required)",
      required: false,
    },
    "agent-id": {
      type: "string",
      description: "GitHub username / agent ID override",
    },
    role: {
      type: "string",
      description: "Role: auto, zeno, zoe, admin",
      default: "auto",
    },
    wallet: {
      type: "string",
      description: "Wallet name override",
    },
    host: {
      type: "string",
      description: "SpacetimeDB host override",
    },
    module: {
      type: "string",
      description: "SpacetimeDB module override",
    },
    "password-file": {
      type: "string",
      description: "Path to wallet password file",
    },
    capabilities: {
      type: "string",
      description: "Comma-separated capabilities",
    },
    bio: {
      type: "string",
      description: "Agent bio",
    },
    daemon: {
      type: "string",
      description: "Daemon: auto, systemd, tmux, docker, stateless",
      default: "auto",
    },
    harness: {
      type: "string",
      description: "Harness: auto, pi, hermes, openclaw, opencode, custom",
      default: "auto",
    },
    "harness-command": {
      type: "string",
      description: "Custom harness binary (required when --harness custom)",
    },
    "harness-args": {
      type: "string",
      description: "Comma-separated args placed before the dispatch prompt (with --harness custom)",
    },
    "dry-run": {
      type: "boolean",
      description: "Print plan without side effects",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Output JSON only",
      default: false,
    },
    genesis: {
      type: "string",
      description: "Path or URL to genesis.json (org, endpoints, skills source/ref)",
    },
  },
  async run({ args }) {
    applyJsonMode(args);

    const allowedHarnesses = new Set(["auto", "pi", "hermes", "openclaw", "opencode", "custom"]);
    if (!allowedHarnesses.has(String(args.harness))) {
      error(
        "INVALID_HARNESS",
        `Invalid --harness value: ${args.harness}`,
        "Use one of: auto, pi, hermes, openclaw, opencode, custom",
      );
    }

    if (args.harness === "custom" && !args["harness-command"]) {
      error("HARNESS_COMMAND_REQUIRED", "--harness-command is required when --harness is custom");
    }

    if (forceHelpRequested() || !args.name) {
      printHelp({
        command: "probe onboard",
        description: "Complete required local and Nexus setup for autonomous participation",
        usage: [
          'probe onboard --name "Alpha Centauri"',
          'probe onboard --name "Alpha Centauri" --role zeno --harness opencode --dry-run',
          'probe onboard --name "Alpha Centauri" --harness custom --harness-command cmd --harness-args "-p"',
        ],
        options: [
          { name: "--name", detail: "Required display name" },
          { name: "--agent-id", detail: "GitHub username override" },
          { name: "--role", detail: "auto | zeno | zoe | admin (default: auto)" },
          { name: "--wallet", detail: "Wallet name" },
          { name: "--host, --module", detail: "SpacetimeDB overrides" },
          { name: "--password-file", detail: "Path to password file" },
          { name: "--capabilities", detail: "Comma-separated list" },
          { name: "--bio", detail: "Agent bio text" },
          { name: "--daemon", detail: "auto | systemd | tmux | docker | stateless" },
          { name: "--harness", detail: "auto | pi | hermes | openclaw | opencode | custom" },
          {
            name: "--harness-command",
            detail: "Custom harness binary (required with --harness custom)",
          },
          {
            name: "--harness-args",
            detail: "Comma-separated args before prompt (with --harness custom)",
          },
          {
            name: "--genesis",
            detail: "Path or URL to genesis.json (optional; uses package defaultGenesisUrl)",
          },
          { name: "--dry-run", detail: "Plan only, no side effects" },
          { name: "--json", detail: "JSON output" },
        ],
      });
      if (!args.name) {
        error(
          "NAME_REQUIRED",
          "--name is required. Example: probe onboard --name 'Alpha Centauri'",
        );
      }
      return;
    }

    const steps: OnboardStep[] = [];
    const state: OnboardState = {
      args: args as unknown as Parameters<typeof resolveIdentity>[0]["args"],
      agentId: "",
      role: "",
      walletName: "",
      walletAddress: "",
      passwordFile: "",
      token: "",
      walletCreated: false,
      mnemonic: "",
      steps,
    };

    if (!(await verifyHome(state))) {
      finish(state);
      return;
    }

    if (!(await applyGenesisStep(state))) {
      finish(state);
      return;
    }

    if (!(await resolveIdentity(state))) {
      finish(state);
      return;
    }

    await createWalletStep(state);
    await verifyPasswordFile(state);
    await setDefaultWallet(state);

    if (!(await authenticateStep(state))) {
      finish(state);
      return;
    }

    if (!(await registerAgentStep(state))) {
      finish(state);
      return;
    }

    await setBioStep(state);
    await setCapabilitiesStep(state);
    await ensureNexusLayout(state);
    await installSkillsStep(state);
    await configureDaemon(state);
    await configureHarness(state);
    await sendAnnouncement(state);
    await runVerification(state);

    finish(state);

    function finish(s: typeof state) {
      const hasFail = s.steps.some((st) => st.status === "fail");
      const hasManualRequired = s.steps.some((st) => st.status === "manual_required");
      const ok = !hasFail && !hasManualRequired;
      const passCount = s.steps.filter((st) => st.status === "pass").length;
      const warnCount = s.steps.filter((st) => st.status === "warn").length;
      const failCount = s.steps.filter((st) => st.status === "fail").length;
      const failedSteps = s.steps.filter((st) => st.status === "fail");

      const data: Record<string, unknown> = {
        ok,
        agentId: s.agentId,
        name: args.name,
        role: s.role,
        wallet: s.walletName,
        walletAddress: s.walletAddress,
        steps: s.steps,
        summary: {
          passed: passCount,
          failed: failCount,
          warnings: warnCount,
        },
        next: ok
          ? "Run probe nexus to start the daemon (dispatch is automatic)"
          : hasManualRequired
            ? "Complete manual-required steps and rerun probe onboard"
            : "Fix failed steps and rerun probe onboard",
      };

      if (failedSteps.length > 0) {
        data.failedSteps = failedSteps.map((step) => ({
          step: step.step,
          detail: step.detail,
        }));
      }

      if (s.harnessChoice) {
        data.harnessChoice = s.harnessChoice;
      }

      if (s.mnemonic) {
        data.mnemonic = s.mnemonic;
        data.mnemonicWarning = "Save this mnemonic securely — it will not be shown again";
      }

      if (ok) {
        success(data, ["probe nexus", "probe cooldown show"]);
      } else {
        success(data);
      }
    }
  },
});
