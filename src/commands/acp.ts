import { defineCommand } from "citty";
import type { HarnessType } from "~/types/config.js";
import { runAcpDoctor } from "~/acp/doctor.js";
import { runAcpSetup } from "~/acp/setup.js";
import { applyJsonMode, success } from "~/utils/output.js";

export default defineCommand({
  meta: {
    name: "acp",
    description: "ACP harness readiness and setup",
  },
  subCommands: {
    doctor: defineCommand({
      meta: {
        name: "doctor",
        description: "Check ACP harness readiness (spawn + initialize)",
      },
      args: {
        harness: { type: "string", description: "Harness id (default: all detected)" },
        json: { type: "boolean", description: "JSON output", default: false },
      },
      async run({ args }) {
        applyJsonMode(args);
        const report = await runAcpDoctor({
          harness: args.harness as HarnessType | undefined,
        });
        if (args.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        for (const row of report.harnesses) {
          console.log(`${row.harness}: ${row.acpOk ? "acp_ok" : "issues"}`);
          for (const issue of row.issues) {
            console.log(`  - ${issue.code}: ${issue.message}`);
          }
        }
        if (!report.acpOk) {
          process.exitCode = 1;
        }
      },
    }),
    setup: defineCommand({
      meta: {
        name: "setup",
        description: "Suggest remediations for ACP harness gaps",
      },
      args: {
        harness: { type: "string", description: "Harness id", required: true },
        fix: { type: "boolean", description: "Attempt safe fixes", default: false },
        json: { type: "boolean", description: "JSON output", default: false },
      },
      async run({ args }) {
        applyJsonMode(args);
        const result = await runAcpSetup({
          harness: args.harness as HarnessType,
          fix: args.fix,
        });
        if (args.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.fixed) {
          success({ harness: result.harness, status: "acp_ok" });
          return;
        }
        success({ harness: result.harness, next: result.next });
        process.exitCode = 1;
      },
    }),
  },
});
