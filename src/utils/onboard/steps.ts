import { execSync } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { callReducer, type Agent, withAuth } from "~/utils/context.js";
import { AgentRole } from "~/utils/enums.js";
import { createWallet, getWalletInfo, walletExists } from "~/utils/wallet.js";
import { authenticateWallet } from "~/utils/auth-flow.js";
import { installSkills } from "~/utils/skills-install.js";
import { daemonAdapters, detectDaemon, type DaemonAdapter } from "~/utils/daemon.js";
import { detectRuntime, runtimeAdapters } from "~/utils/runtime-detection.js";
import { runHealthChecks } from "~/utils/health.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import type { OnboardStep } from "./types.js";

export interface OnboardState {
  args: {
    name: string;
    "agent-id"?: string;
    role: string;
    wallet?: string;
    host?: string;
    module?: string;
    "password-file"?: string;
    capabilities?: string;
    bio?: string;
    daemon: string;
    scheduler: string;
    "dry-run": boolean;
    json: boolean;
  };
  agentId: string;
  role: string;
  walletName: string;
  walletAddress: string;
  passwordFile: string;
  token: string;
  walletCreated: boolean;
  mnemonic: string;
  steps: OnboardStep[];
}

export function addStep(
  state: OnboardState,
  step: string,
  status: OnboardStep["status"],
  detail: string,
): void {
  const existing = state.steps.findIndex((s) => s.step === step);
  if (existing !== -1) {
    state.steps[existing] = { step, status, detail };
  } else {
    state.steps.push({ step, status, detail });
  }
}

export async function verifyHome(state: OnboardState): Promise<boolean> {
  const probeHome = join(homedir(), ".probe");
  try {
    await mkdir(probeHome, { recursive: true });
    const testFile = join(probeHome, ".write_test");
    await writeFile(testFile, "", { mode: 0o600 });
    await access(testFile);
    await unlink(testFile);
    addStep(state, "home", "pass", `${probeHome} is writable`);
    return true;
  } catch {
    addStep(state, "home", "fail", `${probeHome} is not writable`);
    return false;
  }
}

export function randomPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  let pass = "";
  for (let i = 0; i < 32; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

export async function resolveIdentity(state: OnboardState): Promise<boolean> {
  let agentId = state.args["agent-id"];
  let role = state.args.role || "auto";
  let ghAvailable = false;
  try {
    execSync("gh auth status", { stdio: "ignore", timeout: 10000 });
    ghAvailable = true;
    addStep(state, "github", "pass", "gh CLI authenticated");
  } catch {
    addStep(state, "github", "warn", "gh CLI not available or not authenticated");
  }

  if (!agentId && ghAvailable) {
    try {
      agentId = execSync("gh api user --jq .login", {
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      addStep(state, "agent_id", "pass", `Resolved GitHub username: ${agentId}`);
    } catch {
      addStep(state, "agent_id", "fail", "Could not resolve GitHub username");
    }
  }

  if (!agentId) {
    addStep(
      state,
      "agent_id",
      "fail",
      "GitHub CLI not available or not authenticated. Run gh auth login, or pass --agent-id <username> --role zeno explicitly.",
    );
    return false;
  }

  if (role === "auto") {
    let isMember = false;
    if (ghAvailable) {
      try {
        const orgs = execSync("gh org list", {
          encoding: "utf-8",
          timeout: 10000,
        });
        isMember = orgs.includes("zenon-red");
      } catch {
        // ignore
      }
    }
    role = isMember ? "zoe" : "zeno";
    addStep(
      state,
      "role",
      "pass",
      `Auto-detected role: ${role} (${isMember ? "zenon-red org member" : "not a member"})`,
    );
  } else {
    addStep(state, "role", "pass", `Explicit role: ${role}`);
  }

  state.agentId = agentId;
  state.role = role;
  state.walletName = state.args.wallet || agentId;
  state.passwordFile =
    state.args["password-file"] || join(homedir(), ".probe", "wallets", `${state.walletName}.pass`);
  return true;
}

export async function createWalletStep(state: OnboardState): Promise<void> {
  if (await walletExists(state.walletName)) {
    const info = await getWalletInfo(state.walletName);
    state.walletAddress = info?.address || "";
    addStep(state, "wallet", "pass", `Wallet ${state.walletName} exists`);
  } else {
    if (state.args["dry-run"]) {
      addStep(state, "wallet", "skip", "Would create wallet (dry-run)");
    } else {
      const password = randomPassword();
      await mkdir(join(homedir(), ".probe", "wallets"), { recursive: true });
      await writeFile(state.passwordFile, password, { mode: 0o600 });
      const result = await createWallet(state.walletName, password);
      state.walletAddress = result.address;
      state.mnemonic = result.mnemonic;
      state.walletCreated = true;
      addStep(state, "wallet", "pass", `Created wallet ${state.walletName} at ${result.address}`);
    }
  }
}

export async function verifyPasswordFile(state: OnboardState): Promise<void> {
  try {
    await access(state.passwordFile);
    addStep(state, "password_file", "pass", state.passwordFile);
  } catch {
    addStep(state, "password_file", "skip", "Not provided");
  }
}

export async function setDefaultWallet(state: OnboardState): Promise<void> {
  const userConfig = await loadUserConfig();
  if (userConfig.defaultWallet === state.walletName) {
    addStep(state, "default_wallet", "pass", `${state.walletName} already default`);
  } else if (state.args["dry-run"]) {
    addStep(state, "default_wallet", "skip", `Would set ${state.walletName} as default`);
  } else {
    userConfig.defaultWallet = state.walletName;
    await saveUserConfig(userConfig);
    addStep(state, "default_wallet", "pass", `Set ${state.walletName} as default`);
  }
}

export async function authenticateStep(state: OnboardState): Promise<boolean> {
  if (state.args["dry-run"]) {
    addStep(state, "auth", "skip", "Would authenticate (dry-run)");
    return true;
  }
  try {
    const pass = (await readFile(state.passwordFile, "utf-8")).trim();
    const authResult = await authenticateWallet(state.walletName, pass);
    state.token = authResult.token;
    addStep(state, "auth", "pass", "Token cached");
    return true;
  } catch (err) {
    addStep(state, "auth", "fail", err instanceof Error ? err.message : "Authentication failed");
    return false;
  }
}

export function formatDisplayName(name: string, role: string): string {
  if (role === "zeno" && !name.startsWith("Zeno of ")) {
    return `Zeno of ${name}`;
  }
  return name;
}

export async function registerAgentStep(state: OnboardState): Promise<boolean> {
  if (state.args["dry-run"]) {
    addStep(state, "registration", "skip", "Would register agent (dry-run)");
    return true;
  }
  try {
    await withAuth(
      {
        wallet: state.walletName,
        token: state.token,
        host: state.args.host,
        module: state.args.module,
      },
      async (ctx) => {
        const existing = ctx
          .iter<Agent>("agents")
          .find((a) => a.identity.toHexString() === ctx.identity?.toHexString());
        if (existing) {
          addStep(state, "registration", "pass", `Agent ${existing.id} already registered`);
          return;
        }
        await callReducer(ctx, "registerAgent", {
          agentId: state.agentId,
          name: formatDisplayName(state.args.name, state.role),
          role: AgentRole.fromString(state.role),
          zenonAddress: state.walletAddress,
        });
        await new Promise((r) => setTimeout(r, 500));
        const registered = ctx.iter<Agent>("agents").find((a) => a.id === state.agentId);
        if (!registered) {
          if (state.role === "zoe" || state.role === "admin") {
            addStep(
              state,
              "registration",
              "fail",
              "Only whitelisted identities can register as zoe or admin",
            );
          } else {
            addStep(state, "registration", "fail", "Registration failed");
          }
        } else {
          addStep(
            state,
            "registration",
            "pass",
            `Agent ${state.agentId} registered as ${state.role}`,
          );
        }
      },
    );
    return !state.steps.some((s) => s.step === "registration" && s.status === "fail");
  } catch (err) {
    addStep(
      state,
      "registration",
      "fail",
      err instanceof Error ? err.message : "Registration failed",
    );
    return false;
  }
}

export async function setBioStep(state: OnboardState): Promise<void> {
  if (!state.args.bio) {
    addStep(state, "bio", "skip", "Not provided");
    return;
  }
  if (state.args["dry-run"]) {
    addStep(state, "bio", "skip", "Would set bio (dry-run)");
    return;
  }
  try {
    await withAuth(
      {
        wallet: state.walletName,
        token: state.token,
        host: state.args.host,
        module: state.args.module,
      },
      async (ctx) => {
        await callReducer(ctx, "updateAgentBio", { bio: state.args.bio });
      },
    );
    addStep(state, "bio", "pass", "Bio set");
  } catch {
    addStep(state, "bio", "warn", "Failed to set bio");
  }
}

export async function setCapabilitiesStep(state: OnboardState): Promise<void> {
  if (!state.args.capabilities) {
    addStep(state, "capabilities", "skip", "Not provided");
    return;
  }
  if (state.args["dry-run"]) {
    addStep(state, "capabilities", "skip", "Would set capabilities (dry-run)");
    return;
  }
  try {
    const caps = [
      ...new Set(
        state.args.capabilities
          .split(",")
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    await withAuth(
      {
        wallet: state.walletName,
        token: state.token,
        host: state.args.host,
        module: state.args.module,
      },
      async (ctx) => {
        await callReducer(ctx, "updateAgentCapabilities", {
          capabilities: caps,
        });
      },
    );
    addStep(state, "capabilities", "pass", `Capabilities: ${caps.join(", ")}`);
  } catch {
    addStep(state, "capabilities", "warn", "Failed to set capabilities");
  }
}

export async function createWorkspace(state: OnboardState): Promise<void> {
  const workspaceDir = join(homedir(), "zr-workspace");
  const zrmdPath = join(workspaceDir, "ZR.md");
  try {
    await access(zrmdPath);
    addStep(state, "workspace", "pass", `${zrmdPath} exists`);
  } catch {
    if (state.args["dry-run"]) {
      addStep(state, "workspace", "skip", `Would create ${zrmdPath}`);
    } else {
      await mkdir(workspaceDir, { recursive: true });
      const content = `# ZR

## Identity
- Agent: ${state.agentId}
- Role: ${state.role}
- Wallet: ${state.walletName}
- Password: stored at ${state.passwordFile}

## On Wake

## Recent Activity
`;
      await writeFile(zrmdPath, content);
      addStep(state, "workspace", "pass", `Created ${zrmdPath}`);
    }
  }
}

export async function installSkillsStep(state: OnboardState): Promise<void> {
  if (state.args["dry-run"]) {
    addStep(state, "skills", "skip", "Would install skills (dry-run)");
    return;
  }
  const skillsResult = await installSkills();
  addStep(state, "skills", skillsResult.installed ? "pass" : "warn", skillsResult.detail);
}

export async function configureDaemon(state: OnboardState): Promise<void> {
  let daemonAdapter: DaemonAdapter;
  if (state.args.daemon && state.args.daemon !== "auto") {
    daemonAdapter =
      daemonAdapters.find((a) => a.id === state.args.daemon) ||
      daemonAdapters[daemonAdapters.length - 1];
  } else {
    daemonAdapter = await detectDaemon();
  }

  if (state.args["dry-run"]) {
    addStep(
      state,
      "daemon",
      "skip",
      `Would configure ${daemonAdapter.displayName} daemon (dry-run)`,
    );
    return;
  }

  if (daemonAdapter.id === "stateless") {
    addStep(state, "daemon", "pass", "Stateless mode configured");
  } else {
    const result = await daemonAdapter.install({
      wallet: state.walletName,
      host: state.args.host,
      module: state.args.module,
    });
    addStep(state, "daemon", result.success ? "pass" : "warn", result.detail);
  }
}

export async function configureScheduler(state: OnboardState): Promise<void> {
  let runtime = await detectRuntime();
  const schedulerArg = state.args.scheduler;

  if (schedulerArg === "manual") {
    runtime = runtimeAdapters.find((r) => r.id === "universal") ?? runtime;
  } else if (schedulerArg === "managed") {
    if (runtime.id === "universal") {
      addStep(
        state,
        "scheduler",
        "manual_required",
        "No managed runtime detected (hermes/openclaw)",
      );
      return;
    }
  }

  if (state.args["dry-run"]) {
    addStep(
      state,
      "scheduler",
      "skip",
      `Would configure ${runtime.displayName} scheduler (dry-run)`,
    );
    return;
  }
  const scheduleResult = await runtime.scheduler.configure({
    agentId: state.agentId,
    role: state.role,
    intervalMinutes: 30,
    prompt: `Run probe next and follow its instructions exactly.`,
  });
  addStep(
    state,
    "scheduler",
    scheduleResult.success ? "pass" : scheduleResult.mode === "manual" ? "manual_required" : "warn",
    scheduleResult.detail,
  );
}

export async function sendAnnouncement(state: OnboardState): Promise<void> {
  if (state.args["dry-run"]) {
    addStep(state, "onboarding_event", "skip", "Would finalize onboarding event (dry-run)");
    return;
  }
  try {
    await withAuth(
      {
        wallet: state.walletName,
        token: state.token,
        host: state.args.host,
        module: state.args.module,
      },
      async (ctx) => {
        await callReducer(ctx, "finalizeOnboarding", {
          content: `Hi! I'm ${state.args.name}, ready to contribute.`,
          contextId: `onboard:${state.agentId}`,
        });
      },
    );
    addStep(state, "onboarding_event", "pass", "Onboarding event finalized");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to finalize onboarding event";
    addStep(state, "onboarding_event", "warn", message);
  }
}

export async function runVerification(state: OnboardState): Promise<void> {
  const health = await runHealthChecks({
    wallet: state.walletName,
    host: state.args.host,
    module: state.args.module,
    includeAgent: true,
  });
  addStep(
    state,
    "doctor",
    health.ok ? "pass" : "warn",
    `wallet/auth/nexus ${health.ok ? "ok" : "issues detected"}`,
  );
}
