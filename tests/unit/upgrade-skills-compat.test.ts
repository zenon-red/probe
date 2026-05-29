import { afterEach, describe, expect, it } from "bun:test";
import { applyJsonMode, setJsonMode } from "../../src/utils/output-mode.js";
import { emitUpgradeFinish } from "../../src/utils/upgrade-skills-output.js";
import type { ToolchainReport } from "../../src/utils/upgrade-toolchain.js";

const realConsoleLog = console.log.bind(console);
const realConsoleError = console.error.bind(console);

const base = {
  method: "npm",
  currentVersion: "1.0.0",
  targetVersion: "1.1.0",
  latestVersion: "1.1.0",
  updateAvailable: true,
  updated: true,
  checkOnly: false,
};

const sampleToolchain: ToolchainReport = {
  genesisConfigured: true,
  probe: { installed: "1.1.0", expected: "1.0.0", status: "ok" },
  openspec: { expected: "1.3.1", installed: "1.3.1", status: "ok" },
  skills: { expected: "acme/skills@v1.0.0", installed: "acme/skills@v1.0.0", status: "ok" },
};

const toolchainDeps = {
  buildToolchainReport: async () => sampleToolchain,
  syncToolchainFromGenesis: async () => ({
    report: sampleToolchain,
    warnings: ["OpenSpec install command failed — npm install -g @fission-ai/openspec@1.3.1"],
  }),
  formatToolchainHuman: () => ["probe 1.1.0 ok", "openspec 1.3.1 ok"],
};

function captureConsole(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  return { stdout, stderr };
}

afterEach(() => {
  console.log = realConsoleLog;
  console.error = realConsoleError;
  setJsonMode(false);
});

describe("emitUpgradeFinish toolchain", () => {
  it("includes toolchain on --check without syncing", async () => {
    applyJsonMode({ json: true });
    const { stdout } = captureConsole();
    await emitUpgradeFinish(
      { ...base, updated: false, checkOnly: true },
      { checkOnly: true, syncStack: false },
      toolchainDeps,
    );

    const payload = JSON.parse(stdout.join("\n")) as {
      data: { toolchain: ToolchainReport; skillsCompat?: unknown };
    };
    expect(payload.data.toolchain.probe.status).toBe("ok");
    expect(payload.data.skillsCompat).toBeUndefined();
  });

  it("syncs toolchain after upgrade with warnings", async () => {
    applyJsonMode({ json: true });
    const { stdout } = captureConsole();
    await emitUpgradeFinish(base, { syncStack: true }, toolchainDeps);

    const payload = JSON.parse(stdout.join("\n")) as {
      data: { toolchain: ToolchainReport; warnings: string[] };
    };
    expect(payload.data.toolchain.openspec?.status).toBe("ok");
    expect(payload.data.warnings[0]).toContain("OpenSpec install");
  });

  it("prints toolchain lines to stderr in human mode", async () => {
    const { stderr } = captureConsole();
    await emitUpgradeFinish(base, { syncStack: true }, toolchainDeps);

    expect(stderr.join("\n")).toContain("openspec 1.3.1 ok");
  });
});
