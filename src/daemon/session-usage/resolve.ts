import type { ActionRunTelemetry, TokenSource } from "~/acp/types.js";
import type { HarnessType } from "~/types/config.js";
import { extractHarnessUsage, type ExtractHarnessUsageOptions } from "./extract.js";
import type { SessionUsageResult } from "./types.js";

export type ResolvedRunTokens = {
  inputTokens: number;
  outputTokens: number;
  tokenSource: TokenSource;
  tokenMismatch: boolean;
  sessionFile?: string;
  sessionReason?: string;
};

const MISMATCH_RELATIVE = 0.1;
const MISMATCH_INPUT_ABS = 1000;

function acpReportsUsage(telemetry: ActionRunTelemetry): boolean {
  return telemetry.tokenSource !== "none";
}

function acpHasTokenTotals(telemetry: ActionRunTelemetry): boolean {
  return telemetry.inputTokens > 0 || telemetry.outputTokens > 0;
}

function usageDiverges(acp: ActionRunTelemetry, session: SessionUsageResult): boolean {
  if (!session.found) {
    return false;
  }
  const inputDelta = Math.abs(acp.inputTokens - session.inputTokens);
  if (inputDelta >= MISMATCH_INPUT_ABS) {
    return true;
  }
  const acpTotal = acp.inputTokens + acp.outputTokens;
  const sessionTotal = session.inputTokens + session.outputTokens;
  if (sessionTotal === 0) {
    return acpTotal > 0;
  }
  return Math.abs(acpTotal - sessionTotal) / sessionTotal > MISMATCH_RELATIVE;
}

function withSessionFile<T extends ResolvedRunTokens>(row: T, session: SessionUsageResult): T {
  return session.sessionFile ? { ...row, sessionFile: session.sessionFile } : row;
}

export async function resolveRunTokens(
  harness: HarnessType,
  actionId: bigint,
  runStartedAt: Date,
  acp: ActionRunTelemetry,
  options?: ExtractHarnessUsageOptions,
): Promise<ResolvedRunTokens> {
  const session = await extractHarnessUsage(harness, actionId, runStartedAt, options);

  const sessionHasTotals = session.found && (session.inputTokens > 0 || session.outputTokens > 0);

  if (sessionHasTotals) {
    if (!acpReportsUsage(acp) || !acpHasTokenTotals(acp)) {
      return withSessionFile(
        {
          inputTokens: session.inputTokens,
          outputTokens: session.outputTokens,
          tokenSource: "session_file",
          tokenMismatch: false,
          sessionReason: session.reason,
        },
        session,
      );
    }
    if (usageDiverges(acp, session)) {
      return withSessionFile(
        {
          inputTokens: session.inputTokens,
          outputTokens: session.outputTokens,
          tokenSource: "session_file",
          tokenMismatch: true,
          sessionReason: session.reason,
        },
        session,
      );
    }
  }

  if (acpReportsUsage(acp) && acpHasTokenTotals(acp)) {
    return {
      inputTokens: acp.inputTokens,
      outputTokens: acp.outputTokens,
      tokenSource: acp.tokenSource,
      tokenMismatch: false,
    };
  }

  if (session.found) {
    return {
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      tokenSource: "session_file",
      tokenMismatch: false,
      sessionReason: session.reason,
    };
  }

  return {
    inputTokens: 0,
    outputTokens: 0,
    tokenSource: "none",
    tokenMismatch: false,
    sessionReason: session.reason,
  };
}
