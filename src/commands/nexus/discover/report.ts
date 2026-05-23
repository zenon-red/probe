import { defineCommand } from "citty";
import { applyJsonMode, success } from "~/utils/output.js";
import { runReducerCommand } from "~/utils/reducer-command.js";
import { runWithBoundary } from "./shared.js";

export default defineCommand({
  meta: { name: "report", description: "Report a discovered task from current work" },
  args: {
    task: { type: "string", description: "Current task ID", required: true },
    project: { type: "string", description: "Project ID", required: true },
    title: { type: "string", description: "Task title", required: true },
    type: { type: "string", description: "Task type: bug, improvement, feature" },
    severity: { type: "string", description: "Severity: low, medium, high, critical" },
    description: { type: "string", description: "Description" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await runReducerCommand(args, {
        subscribe: [],
        reducer: (ctx) => ctx.conn.reducers.discoverTask,
        params: {
          currentTaskId: BigInt(args.task!),
          projectId: BigInt(args.project!),
          title: args.title!,
          description: args.description || "",
          priority: 5,
          taskType: args.type || "improvement",
          severity: args.severity || "medium",
        },
      });
      success({ reported: true, title: args.title });
    });
  },
});
