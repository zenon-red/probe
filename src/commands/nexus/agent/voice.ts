import { defineCommand } from "citty";
import {
  AGENT_SUBSCRIBE,
  callProcedure,
  commandContextOptions,
  withAuth,
} from "~/utils/context.js";
import type { GenerateVoiceArgs, GenerateVoiceResult } from "~/module_bindings/types/procedures.js";
import { errorMessage } from "~/utils/errors.js";
import { applyJsonMode, error, success } from "~/utils/output.js";
import {
  DEFAULT_VOICE_CONTEXT_TYPE,
  MAX_VOICE_TRANSCRIPT_LENGTH,
  runWithBoundary,
} from "./shared.js";

export default defineCommand({
  meta: { name: "voice", description: "Submit a voice announcement (BYO audio URL)" },
  args: {
    transcript: {
      type: "positional",
      name: "transcript",
      description: "Voice transcript",
      required: true,
    },
    audioUrl: { type: "string", description: "Audio URL (required)", required: true },
    contextType: {
      type: "string",
      description: "Context type (default: status_update)",
    },
    wallet: { type: "string", description: "Wallet name" },
    host: { type: "string", description: "SpacetimeDB host" },
    module: { type: "string", description: "Module name" },
    json: { type: "boolean", description: "Output JSON", default: false },
  },
  async run({ args }) {
    applyJsonMode(args);

    const transcript = args.transcript.trim();
    if (!transcript) {
      error("TRANSCRIPT_REQUIRED", "Transcript required.");
    }
    if (transcript.length > MAX_VOICE_TRANSCRIPT_LENGTH) {
      error("TRANSCRIPT_TOO_LONG", `Transcript exceeds ${MAX_VOICE_TRANSCRIPT_LENGTH} characters.`);
    }

    await runWithBoundary(async () => {
      try {
        await withAuth(commandContextOptions(args, { subscribe: AGENT_SUBSCRIBE }), async (ctx) => {
          const contextType = args.contextType || DEFAULT_VOICE_CONTEXT_TYPE;
          const params: GenerateVoiceArgs = {
            transcript,
            audioUrl: args.audioUrl,
            contextType,
          };
          const result = await callProcedure<GenerateVoiceArgs, GenerateVoiceResult>(
            ctx,
            ctx.conn.procedures.generateVoice,
            params,
          );

          if (typeof result === "string") {
            error("PROCEDURE_FAILED", result);
          }

          success({
            ok: true,
            announcementId: result.id,
            seq: result.seq,
            agentName: result.agentName,
            keyPrefix: result.keyPrefix,
            audioUrl: args.audioUrl,
            contextType,
          });
        });
      } catch (err) {
        error("PROCEDURE_FAILED", errorMessage(err, "Unknown error"));
      }
    });
  },
});
