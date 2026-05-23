import { defineCommand } from "citty";
import { CommandContext, commandContextOptions } from "~/utils/context.js";
import { applyJsonMode, success } from "~/utils/output.js";
import { runWithBoundary } from "../discover/shared.js";

const CHANNELS_SUBSCRIBE = [
  "SELECT * FROM channels",
  "SELECT * FROM projects",
  "SELECT * FROM project_channels",
];

export const messageChannelsCommand = defineCommand({
  meta: { name: "channels", description: "List channels and project channels" },
  args: {
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    await runWithBoundary(async () => {
      await using ctx = await CommandContext.create(
        commandContextOptions(args, { subscribe: CHANNELS_SUBSCRIBE }),
      );
      const channels = ctx.channels;
      const projects = ctx.projects;
      const projectChannels = ctx.projectChannels;

      const projectChannelSet = new Set(projectChannels.map((pc) => pc.projectId.toString()));
      const projectsWithChannels = projects.filter((p) => projectChannelSet.has(p.id.toString()));

      success({
        channels,
        projects: projectsWithChannels,
        channelCount: channels.length,
        projectCount: projectsWithChannels.length,
      });
    });
  },
});
