import { execSync } from "node:child_process";
import { SHELL_TIMEOUT } from "./timeouts.js";

export function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", timeout: SHELL_TIMEOUT.SHORT });
    return true;
  } catch {
    return false;
  }
}
