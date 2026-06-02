import { defineCommand } from "citty";
import { createEventBus, type DaemonEvent } from "~/daemon/events.js";
import { connectDaemonEventStream } from "~/daemon/ipc-lock.js";
import { mountNexusTui } from "~/daemon/tui/render.js";
import { getConfig } from "~/utils/config.js";
import { error } from "~/utils/output.js";

type RunNexusTuiOptions = {
  failIfMissing?: boolean;
};

function missingDaemonMessage(wallet: string): string {
  return `No running Nexus daemon found for wallet ${wallet}`;
}

export async function runNexusTui(
  args: Record<string, unknown>,
  options: RunNexusTuiOptions = {},
): Promise<boolean> {
  const config = await getConfig();
  const wallet = (args.wallet as string | undefined) ?? config.defaultWallet;
  if (!wallet) {
    if (options.failIfMissing === false) return false;
    error("ARGS_REQUIRED", "--wallet is required (or set defaultWallet in config)");
  }

  if (!process.stderr.isTTY) {
    if (options.failIfMissing === false) return false;
    error("TTY_REQUIRED", "probe nexus tui requires an interactive terminal");
  }

  let stream: Awaited<ReturnType<typeof connectDaemonEventStream>> | null = null;
  const pendingEvents: DaemonEvent[] = [];
  let mounted = false;
  const bus = createEventBus({ logLevel: "debug", write: () => {} });
  try {
    stream = await connectDaemonEventStream(wallet, (event) => {
      if (mounted) {
        bus.emit(event);
      } else {
        pendingEvents.push(event);
      }
    });
  } catch {
    if (options.failIfMissing === false) return false;
    error("DAEMON_NOT_RUNNING", missingDaemonMessage(wallet));
  }

  const tui = mountNexusTui(bus, { wallet });
  if (!tui) {
    stream.close();
    if (options.failIfMissing === false) return false;
    error("TTY_REQUIRED", "probe nexus tui requires an interactive terminal");
  }

  mounted = true;
  for (const event of pendingEvents) bus.emit(event);

  try {
    await tui.waitUntilExit();
  } finally {
    stream?.close();
    tui.unmount();
  }

  return true;
}

export default defineCommand({
  meta: {
    name: "tui",
    description: "Attach a live TUI to an existing Nexus daemon",
  },
  args: {
    wallet: { type: "string", description: "Wallet whose daemon to attach to" },
  },
  async run({ args }) {
    await runNexusTui(args as Record<string, unknown>, { failIfMissing: true });
  },
});
