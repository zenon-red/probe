import { defineCommand } from "citty";
import { log } from "@clack/prompts";
import { forceHelpRequested, printHelp } from "~/utils/help.js";
import { applyJsonMode, error, info, isJsonMode, note, success, warning } from "~/utils/output.js";
import type { OnboardStep } from "~/utils/onboard/types.js";
import {
  authenticateStep,
  configureDaemon,
  configureHarness,
  createWalletStep,
  createWorkspace,
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
      description: "Custom harness command (required when --harness custom)",
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
    const state = {
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

    // 1. Verify writable home
    if (!(await verifyHome(state))) {
      finish(state);
      return;
    }

    // 2-3. GitHub CLI + identity + role
    if (!(await resolveIdentity(state))) {
      finish(state);
      return;
    }

    // 4. Wallet
    await createWalletStep(state);

    // 5. Password file
    await verifyPasswordFile(state);

    // 6. Default wallet
    await setDefaultWallet(state);

    // 7. Auth
    if (!(await authenticateStep(state))) {
      finish(state);
      return;
    }

    // 8. Registration
    if (!(await registerAgentStep(state))) {
      finish(state);
      return;
    }

    // 9. Bio
    await setBioStep(state);

    // 10. Capabilities
    await setCapabilitiesStep(state);

    // 11. ZR.md
    await createWorkspace(state);

    // 12. Skills
    await installSkillsStep(state);

    // 13. Daemon
    await configureDaemon(state);

    // 14. Harness (replaces scheduler)
    await configureHarness(state);

    // 15. Announcement
    await sendAnnouncement(state);

    // 16. Verification
    await runVerification(state);

    finish(state);

    function finish(s: typeof state) {
      const hasFail = s.steps.some((st) => st.status === "fail");
      const hasManualRequired = s.steps.some((st) => st.status === "manual_required");
      const ok = !hasFail && !hasManualRequired;
      const passCount = s.steps.filter((st) => st.status === "pass").length;
      const warnCount = s.steps.filter((st) => st.status === "warn").length;
      const failCount = s.steps.filter((st) => st.status === "fail").length;

      const summary = {
        ok,
        agentId: s.agentId,
        name: args.name,
        role: s.role,
        wallet: s.walletName,
        next: ok
          ? "Run probe nexus to start the daemon (dispatch is automatic)"
          : hasManualRequired
            ? "Complete manual-required steps and rerun probe onboard"
            : "Fix failed steps and rerun probe onboard",
      };
      success(summary);

      if (!isJsonMode()) {
        const lines = [
          `Agent: ${s.agentId}`,
          `Name:  ${args.name}`,
          `Role:  ${s.role}`,
          `Wallet: ${s.walletName}`,
          `Steps: ${passCount} passed, ${failCount} failed, ${warnCount} warnings`,
        ];
        note(lines.join("\n"), ok ? "Onboard Complete" : "Onboard Incomplete");

        const failedSteps = s.steps.filter((st) => st.status === "fail");
        if (failedSteps.length > 0) {
          for (const step of failedSteps) {
            log.error(`${step.step}: ${step.detail}`);
          }
        }

        if (s.mnemonic) {
          warning("Save this mnemonic securely — it will not be shown again");
          info(s.mnemonic);
        }
      }
    }
  },
});
