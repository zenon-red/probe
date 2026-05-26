import { execSync } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_SUBSCRIBE, callReducer, commandContextOptions, withAuth } from "~/utils/context.js";
import { AgentRole } from "~/utils/enums.js";
import { createWallet, getWalletInfo, walletExists } from "~/utils/wallet.js";
import { authenticateWallet } from "~/utils/auth-flow.js";
import { persistGenesisFromSource } from "~/utils/genesis-apply.js";
import { checkSkillsCompatForGenesis } from "~/utils/genesis-skills.js";
import { formatSkillsSpec, loadSkillsSpecFromConfig } from "~/utils/genesis-skills-spec.js";
import { installSkills } from "~/utils/skills-install.js";
import { daemonAdapters, detectDaemon, type DaemonAdapter } from "~/utils/daemon.js";
import {
  autoDetectHarness,
  detectHarnesses,
  type HarnessDetectionResult,
} from "~/utils/harness-detection.js";
import { runHealthChecks } from "~/utils/health.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";
import { errorMessage } from "~/utils/errors.js";
import { SHELL_TIMEOUT } from "~/utils/timeouts.js";
import type { OnboardStep } from "./types.js";

type MembershipCheck =
  | { status: "member" }
  | { status: "not_member" }
  | { status: "unknown"; reason: string };

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
    harness: string;
    "harness-command"?: string;
    "harness-args"?: string;
    "dry-run": boolean;
    json: boolean;
    genesis?: string;
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

function checkGithubOrgMembership(githubOrg: string): MembershipCheck {
  try {
    const memberships = execSync("gh api user/memberships/orgs --jq '.[].organization.login'", {
      encoding: "utf-8",
      timeout: SHELL_TIMEOUT.MEDIUM,
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    return memberships.includes(githubOrg) ? { status: "member" } : { status: "not_member" };
  } catch (err) {
    return { status: "unknown", reason: errorMessage(err, "GitHub membership check failed") };
  }
}

export async function resolveIdentity(state: OnboardState): Promise<boolean> {
  let agentId = state.args["agent-id"];
  let role = state.args.role || "auto";
  let ghAvailable = false;
  try {
    execSync("gh auth status", { stdio: "ignore", timeout: SHELL_TIMEOUT.MEDIUM });
    ghAvailable = true;
    addStep(state, "github", "pass", "gh CLI authenticated");
  } catch {
    addStep(state, "github", "warn", "gh CLI not available or not authenticated");
  }

  if (!agentId && ghAvailable) {
    try {
      agentId = execSync("gh api user --jq .login", {
        encoding: "utf-8",
        timeout: SHELL_TIMEOUT.MEDIUM,
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
    const config = await loadUserConfig();
    const githubOrg = config.githubOrg?.trim();
    let isMember = false;
    if (!githubOrg) {
      role = "zeno";
      addStep(
        state,
        "role",
        "warn",
        "No org.githubOrg in genesis config; defaulting to zeno. Pass --genesis or --role explicitly.",
      );
    } else if (ghAvailable) {
      const membership = checkGithubOrgMembership(githubOrg);
      isMember = membership.status === "member";
      role = isMember ? "zoe" : "zeno";
      addStep(
        state,
        "role",
        membership.status === "unknown" ? "warn" : "pass",
        membership.status === "unknown"
          ? `Cannot verify ${githubOrg} membership (${membership.reason}); defaulting to zeno`
          : `Auto-detected role: ${role} (${githubOrg} member: ${isMember})`,
      );
    } else {
      role = "zeno";
      addStep(
        state,
        "role",
        "warn",
        `Cannot verify ${githubOrg} membership without gh; defaulting to zeno`,
      );
    }
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
    addStep(state, "auth", "fail", errorMessage(err, "Authentication failed"));
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
      commandContextOptions(
        { wallet: state.walletName, host: state.args.host, module: state.args.module },
        { token: state.token, subscribe: AGENT_SUBSCRIBE },
      ),
      async (ctx) => {
        const existing = ctx.agents.find(
          (a) => a.identity.toHexString() === ctx.identity?.toHexString(),
        );
        if (existing) {
          addStep(state, "registration", "pass", `Agent ${existing.id} already registered`);
          return;
        }
        await callReducer(ctx, ctx.conn.reducers.registerAgent, {
          agentId: state.agentId,
          name: formatDisplayName(state.args.name, state.role),
          role: AgentRole.fromString(state.role),
          zenonAddress: state.walletAddress,
        });
        await new Promise((r) => setTimeout(r, 500));
        const registered = ctx.agents.find((a) => a.id === state.agentId);
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
    addStep(state, "registration", "fail", errorMessage(err, "Registration failed"));
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
      commandContextOptions(
        { wallet: state.walletName, host: state.args.host, module: state.args.module },
        { token: state.token, subscribe: [] },
      ),
      async (ctx) => {
        await callReducer(ctx, ctx.conn.reducers.updateAgentBio, { bio: state.args.bio! });
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
      commandContextOptions(
        { wallet: state.walletName, host: state.args.host, module: state.args.module },
        { token: state.token, subscribe: [] },
      ),
      async (ctx) => {
        await callReducer(ctx, ctx.conn.reducers.updateAgentCapabilities, {
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

export async function applyGenesisStep(state: OnboardState): Promise<boolean> {
  const source = state.args.genesis?.trim();
  if (!source) {
    return true;
  }
  if (state.args["dry-run"]) {
    addStep(state, "genesis", "skip", `Would apply genesis from ${source} (dry-run)`);
    return true;
  }
  try {
    const { parsed } = await persistGenesisFromSource(source);
    addStep(
      state,
      "genesis",
      "pass",
      `Applied ${parsed.genesisId} (${parsed.githubOrg}, skills ${parsed.skillsSource}@${parsed.skillsRef})`,
    );
    return true;
  } catch (err) {
    addStep(state, "genesis", "fail", errorMessage(err, "Genesis apply failed"));
    return false;
  }
}

export async function installSkillsStep(state: OnboardState): Promise<void> {
  const spec = await loadSkillsSpecFromConfig();
  if (!spec) {
    addStep(
      state,
      "skills",
      "warn",
      "No genesis skills configured. Pass --genesis <manifest> or run probe genesis apply first.",
    );
    return;
  }

  if (state.args["dry-run"]) {
    addStep(state, "skills", "skip", `Would install ${formatSkillsSpec(spec)} (dry-run)`);
    return;
  }

  const skillsResult = await installSkills(spec);
  const compat = checkSkillsCompatForGenesis(spec.source, spec.ref);
  const status = skillsResult.installed && compat.status === "ok" ? "pass" : "warn";
  const detail = skillsResult.installed ? compat.message : skillsResult.detail;
  addStep(state, "skills", status, detail);
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

export async function configureHarness(state: OnboardState): Promise<void> {
  const harnessArg = state.args.harness || "auto";
  let harness: HarnessDetectionResult;

  if (harnessArg === "custom") {
    const command = state.args["harness-command"];
    if (!command) {
      addStep(state, "harness", "fail", "--harness-command required when --harness custom");
      return;
    }
    const harnessArgs = (state.args["harness-args"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    harness = { harness: "custom", command, args: harnessArgs };
  } else if (harnessArg === "auto") {
    try {
      harness = autoDetectHarness();
    } catch (err) {
      addStep(state, "harness", "warn", errorMessage(err, "Harness auto-detection failed"));
      return;
    }
  } else {
    const detected = detectHarnesses();
    const match = detected.find((d) => d.harness === harnessArg);
    if (!match) {
      addStep(state, "harness", "fail", `Harness "${harnessArg}" not detected`);
      return;
    }
    harness = match;
  }

  if (state.args["dry-run"]) {
    addStep(state, "harness", "skip", `Would configure ${harness.harness} harness (dry-run)`);
    return;
  }

  // Write harness to config
  const userConfig = await loadUserConfig();
  userConfig.harness = harness.harness;
  if (harness.harness === "custom") {
    userConfig.harnessCommand = harness.command;
    userConfig.harnessArgs = harness.args;
  }
  await saveUserConfig(userConfig);

  addStep(state, "harness", "pass", `Harness configured: ${harness.harness}`);
}

export async function sendAnnouncement(state: OnboardState): Promise<void> {
  if (state.args["dry-run"]) {
    addStep(state, "onboarding_event", "skip", "Would finalize onboarding event (dry-run)");
    return;
  }
  try {
    await withAuth(
      commandContextOptions(
        { wallet: state.walletName, host: state.args.host, module: state.args.module },
        { token: state.token, subscribe: [] },
      ),
      async (ctx) => {
        await callReducer(ctx, ctx.conn.reducers.finalizeOnboarding, {
          content: `Hi! I'm ${state.args.name}, ready to contribute.`,
          contextId: `onboard:${state.agentId}`,
        });
      },
    );
    addStep(state, "onboarding_event", "pass", "Onboarding event finalized");
  } catch (err) {
    const message = errorMessage(err, "Failed to finalize onboarding event");
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
