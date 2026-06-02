import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { sidecarPathForAction } from "./sidecar.js";
import type { ActionSidecar } from "./sidecar.js";

export { sidecarPathForAction };

export async function readActionSidecar(
  wallet: string,
  actionId: string,
): Promise<ActionSidecar | null> {
  const path = sidecarPathForAction(wallet, actionId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as ActionSidecar;
  } catch {
    return null;
  }
}
