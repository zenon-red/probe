import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT_HELP_COMMAND_ORDER,
  TOP_LEVEL_COMMAND_DESCRIPTIONS,
} from "../../src/utils/help-discovery.js";

describe("root help guards", () => {
  it("does not advertise lab aggregation flags", () => {
    const blob = JSON.stringify({ ROOT_HELP_COMMAND_ORDER, TOP_LEVEL_COMMAND_DESCRIPTIONS });
    expect(blob).not.toContain("all-agents");
    expect(blob).not.toContain("all_agents");
  });

  it("lab scripts do not reference removed observability scripts", () => {
    const labScripts = join(import.meta.dir, "../../../nexus/lab/scripts");
    const removed = ["watch-lab-status.sh", "audit-sessions.sh", "lab-daemon-logs.sh"];
    for (const name of removed) {
      const path = join(labScripts, name);
      expect(() => readFileSync(path)).toThrow();
    }
  });
});
