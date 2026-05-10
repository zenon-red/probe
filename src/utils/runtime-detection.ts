import { execFileSync, execSync } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadUserConfig } from "~/utils/user-config.js";

export interface ScheduleInput {
  agentId: string;
  role: string;
  intervalMinutes: number;
  prompt: string;
}

export interface ScheduleResult {
  success: boolean;
  mode: "managed" | "file" | "manual";
  detail: string;
}

export interface ScheduleVerifyResult {
  configured: boolean;
  detail: string;
}

export interface SchedulerAdapter {
  supported: boolean;
  mode: "managed" | "file" | "manual";
  configure(input: ScheduleInput): Promise<ScheduleResult>;
  verify(): Promise<ScheduleVerifyResult>;
}

export interface RuntimeAdapter {
  id: string;
  displayName: string;
  detectCurrent(): Promise<boolean>;
  detectInstalled(): Promise<boolean>;
  scheduler: SchedulerAdapter;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const hermesScheduler: SchedulerAdapter = {
  supported: true,
  mode: "managed",
  async configure(input) {
    if (!commandExists("hermes")) {
      return {
        success: false,
        mode: "manual",
        detail: "hermes CLI not found in PATH",
      };
    }
    try {
      const cronExpr = `*/${input.intervalMinutes} * * * *`;
      const message =
        "Load and internalize the skill zr-nexus-primer. Execute probe next and follow its instructions exactly.";
      execFileSync(
        "hermes",
        ["cron", "create", cronExpr, message, "--name", `ZENON ${input.agentId} wake`],
        {
          stdio: "ignore",
          timeout: 15000,
        },
      );
      return {
        success: true,
        mode: "managed",
        detail: `Created hermes cron job for ${input.agentId}`,
      };
    } catch {
      return {
        success: false,
        mode: "manual",
        detail: "hermes cron create failed",
      };
    }
  },
  async verify() {
    if (!commandExists("hermes")) {
      return { configured: false, detail: "hermes CLI not found" };
    }
    try {
      execSync("hermes cron list", { stdio: "ignore", timeout: 10000 });
      return { configured: true, detail: "hermes cron list succeeded" };
    } catch {
      return { configured: false, detail: "hermes cron list failed" };
    }
  },
};

const openclawScheduler: SchedulerAdapter = {
  supported: true,
  mode: "managed",
  async configure(input) {
    if (!commandExists("openclaw")) {
      return {
        success: false,
        mode: "manual",
        detail: "openclaw CLI not found in PATH",
      };
    }
    try {
      const cronExpr = `*/${input.intervalMinutes} * * * *`;
      const message =
        "Load and internalize the skill zr-nexus-primer. Execute probe next and follow its instructions exactly.";
      execFileSync(
        "openclaw",
        [
          "cron",
          "add",
          "--name",
          `ZENON ${input.agentId} wake`,
          "--cron",
          cronExpr,
          "--message",
          message,
        ],
        { stdio: "ignore", timeout: 15000 },
      );
      return {
        success: true,
        mode: "managed",
        detail: `Created openclaw cron job for ${input.agentId}`,
      };
    } catch {
      return {
        success: false,
        mode: "manual",
        detail: "openclaw cron add failed",
      };
    }
  },
  async verify() {
    if (!commandExists("openclaw")) {
      return { configured: false, detail: "openclaw CLI not found" };
    }
    try {
      execSync("openclaw cron list", { stdio: "ignore", timeout: 10000 });
      return { configured: true, detail: "openclaw cron list succeeded" };
    } catch {
      return { configured: false, detail: "openclaw cron list failed" };
    }
  },
};

const universalScheduler: SchedulerAdapter = {
  supported: false,
  mode: "manual",
  async configure(_input) {
    const config = await loadUserConfig();
    if (config.schedulerConfirmed) {
      return {
        success: true,
        mode: "manual",
        detail: "Scheduler manually confirmed (config.json)",
      };
    }
    return {
      success: false,
      mode: "manual",
      detail: "Universal runtime — agentic scheduler setup required",
    };
  },
  async verify() {
    const config = await loadUserConfig();
    if (config.schedulerConfirmed) {
      return {
        configured: true,
        detail: "Scheduler manually confirmed (config.json)",
      };
    }
    return {
      configured: false,
      detail: "Universal runtime — agentic scheduler setup required",
    };
  },
};

export const runtimeAdapters: RuntimeAdapter[] = [
  {
    id: "hermes",
    displayName: "Hermes Agent",
    async detectCurrent() {
      return !!process.env.HERMES_HOME || process.argv.some((a) => a.includes("hermes"));
    },
    async detectInstalled() {
      return (await pathExists(join(homedir(), ".hermes"))) || commandExists("hermes");
    },
    scheduler: hermesScheduler,
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    async detectCurrent() {
      return !!process.env.OPENCLAW_HOME || process.argv.some((a) => a.includes("openclaw"));
    },
    async detectInstalled() {
      return (await pathExists(join(homedir(), ".openclaw"))) || commandExists("openclaw");
    },
    scheduler: openclawScheduler,
  },
  {
    id: "universal",
    displayName: "Universal",
    async detectCurrent() {
      return true; // fallback
    },
    async detectInstalled() {
      return true; // always available
    },
    scheduler: universalScheduler,
  },
];

export async function detectRuntime(): Promise<RuntimeAdapter> {
  for (const adapter of runtimeAdapters) {
    if (await adapter.detectCurrent()) {
      return adapter;
    }
  }
  for (const adapter of runtimeAdapters) {
    if (await adapter.detectInstalled()) {
      return adapter;
    }
  }
  return runtimeAdapters[runtimeAdapters.length - 1]; // universal
}
