import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeActionSidecar, sidecarPathForAction } from "../../src/daemon/sidecar.js";
import { readActionSidecar } from "../../src/daemon/sidecar-read.js";

describe("action sidecar", () => {
  it("writes and reads sidecar under nexus audit dir", async () => {
    const prevAuditRoot = process.env.PROBE_NEXUS_AUDIT_ROOT;
    const root = await mkdtemp(join(tmpdir(), "nexus-audit-"));
    process.env.PROBE_NEXUS_AUDIT_ROOT = root;
    try {
      const wallet = "test-wallet";
      await writeActionSidecar(wallet, {
        actionId: "99",
        harness: "opencode",
        startedAt: "2026-06-01T00:00:00.000Z",
        finishedAt: "2026-06-01T01:00:00.000Z",
        exitCode: 0,
        tokens: { in: 1, out: 2 },
      });
      const action = await readActionSidecar(wallet, "99");
      expect(action?.actionId).toBe("99");
      expect(action?.tokens).toEqual({ in: 1, out: 2 });
      const path = sidecarPathForAction(wallet, "99");
      expect(path).toBe(join(root, wallet, "actions", "99.json"));
      const raw = await readFile(path, "utf8");
      expect(JSON.parse(raw).harness).toBe("opencode");
    } finally {
      if (prevAuditRoot == null) {
        delete process.env.PROBE_NEXUS_AUDIT_ROOT;
      } else {
        process.env.PROBE_NEXUS_AUDIT_ROOT = prevAuditRoot;
      }
    }
  });

  it("honors PROBE_NEXUS_AUDIT_ROOT", async () => {
    const prevAuditRoot = process.env.PROBE_NEXUS_AUDIT_ROOT;
    const root = await mkdtemp(join(tmpdir(), "nexus-audit-"));
    process.env.PROBE_NEXUS_AUDIT_ROOT = root;
    try {
      expect(sidecarPathForAction("w", "1")).toBe(join(root, "w", "actions", "1.json"));
    } finally {
      if (prevAuditRoot == null) {
        delete process.env.PROBE_NEXUS_AUDIT_ROOT;
      } else {
        process.env.PROBE_NEXUS_AUDIT_ROOT = prevAuditRoot;
      }
    }
  });
});
