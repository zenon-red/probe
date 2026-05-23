import { errorMessage, failWithConnectionOrUnexpected, isProbeError } from "~/utils/errors.js";

export async function runWithBoundary(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isProbeError(err)) throw err;
    failWithConnectionOrUnexpected(errorMessage(err));
  }
}
