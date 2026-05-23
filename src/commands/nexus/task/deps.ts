import { defineCommand } from "citty";
import { callReducer, CommandContext, commandContextOptions, withAuth } from "~/utils/context.js";
import { errorMessage, failWithConnectionOrUnexpected } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";

export const taskDepsCommand = defineCommand({
  meta: { name: "deps", description: "List or add task dependencies" },
  args: {
    id: { type: "positional", description: "Task ID", required: true },
    "add-dep": { type: "string", description: "Add dependency task ID" },
    list: { type: "boolean", description: "List dependencies", default: false },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const taskIdBigInt = BigInt(args.id);

    if (args["add-dep"]) {
      try {
        await withAuth(commandContextOptions(args, { subscribe: [] }), async (ctx) => {
          await callReducer(ctx, ctx.conn.reducers.addTaskDependency, {
            taskId: taskIdBigInt,
            dependsOnId: BigInt(args["add-dep"] as string),
            dependencyType: { tag: "Blocks" },
          });
        });
        success({ added: true, taskId: args.id, dependsOn: args["add-dep"] });
      } catch (err) {
        error("REDUCER_FAILED", errorMessage(err, "Unknown error"));
      }
      return;
    }

    if (args.list) {
      try {
        await using ctx = await CommandContext.create(
          commandContextOptions(args, { subscribe: ["SELECT * FROM task_dependencies"] }),
        );
        const deps = ctx.taskDependencies;
        const taskDeps = deps.filter(
          (d) => d.taskId === taskIdBigInt || d.dependsOnId === taskIdBigInt,
        );

        success({ dependencies: taskDeps });
      } catch (err) {
        failWithConnectionOrUnexpected(errorMessage(err));
      }
      return;
    }

    error(
      "DEPS_ACTION_REQUIRED",
      "Use --add-dep <taskId> to add a dependency or --list to view dependencies",
      "Examples: probe task deps 42 --list | probe task deps 42 --add-dep 17",
    );
  },
});
