import { defineCommand } from "citty";
import { commandContextOptions, withAuth } from "~/utils/context.js";
import { TaskStatus } from "~/utils/enums.js";
import { applyJsonMode, success } from "~/utils/output.js";

export const taskWatchCommand = defineCommand({
  meta: { name: "watch", description: "Watch task changes in real time" },
  args: {
    status: { type: "string", description: "Status filter" },
    timeout: { type: "string", description: "Watch timeout (seconds)", default: "60" },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);
    const timeout = Math.min(parseInt(args.timeout || "60", 10), 300);

    await withAuth(
      commandContextOptions(args, { subscribe: ["SELECT * FROM tasks"] }),
      async (ctx) => {
        success({
          watching: true,
          timeoutSeconds: timeout,
          statusFilter: args.status || null,
        });

        const waitForStop = new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
            resolve();
          }, timeout * 1000);

          const onSignal = () => {
            clearTimeout(timer);
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
            resolve();
          };

          process.on("SIGINT", onSignal);
          process.on("SIGTERM", onSignal);
        });

        ctx.db.tasks.onInsert((_ctx, task) => {
          if (!args.status || TaskStatus.matches(task.status, args.status)) {
            success({
              id: task.id.toString(),
              title: task.title,
              change_type: "created",
            });
          }
        });

        ctx.db.tasks.onUpdate((_ctx, _old, newTask) => {
          if (!args.status || TaskStatus.matches(newTask.status, args.status)) {
            success({
              id: newTask.id.toString(),
              title: newTask.title,
              change_type: "updated",
            });
          }
        });

        await waitForStop;
      },
    );
  },
});
