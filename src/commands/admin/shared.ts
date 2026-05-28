import { Identity } from "spacetimedb";
import { errorMessage, failWithConnectionOrUnexpected, isProbeError } from "~/utils/errors.js";
import { error } from "~/utils/output.js";

export async function runWithBoundary(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isProbeError(err)) throw err;
    failWithConnectionOrUnexpected(errorMessage(err));
  }
}

export function parseTargetIdentityHex(raw: string): Identity {
  const targetIdentity = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(targetIdentity)) {
    error(
      "INVALID_IDENTITY",
      "Identity must be a 64-character hex string (zenon address support is planned)",
    );
  }
  return Identity.fromString(targetIdentity.toLowerCase());
}
