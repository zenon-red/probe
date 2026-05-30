import type { HarnessType } from "~/types/config.js";
import { detectHarnesses } from "~/utils/harness-detection.js";
import { checkHarnessAcpReadiness, type AcpReadinessResult } from "./readiness.js";

export type AcpDoctorReport = {
  acpOk: boolean;
  harnesses: AcpReadinessResult[];
};

export async function runAcpDoctor(options?: {
  harness?: HarnessType;
  harnessCommand?: string;
}): Promise<AcpDoctorReport> {
  const targets: HarnessType[] = options?.harness
    ? [options.harness]
    : detectHarnesses().map((row) => row.harness);

  const harnesses: AcpReadinessResult[] = [];
  for (const harness of targets) {
    harnesses.push(await checkHarnessAcpReadiness(harness, options?.harnessCommand));
  }

  return {
    acpOk: harnesses.length > 0 && harnesses.every((row) => row.acpOk),
    harnesses,
  };
}
