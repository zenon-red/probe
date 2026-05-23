import { clearConfigCache, getConfig } from "~/utils/config.js";
import { error } from "~/utils/output.js";
import { loadUserConfig, saveUserConfig } from "~/utils/user-config.js";

export const VALID_CONFIG_KEYS = [
  "issuer",
  "walletDir",
  "defaultWallet",
  "autoUpdate",
  "tokenCacheDir",
  "requestTimeout",
  "spacetime.host",
  "spacetime.module",
] as const;

export type ValidConfigKey = (typeof VALID_CONFIG_KEYS)[number];

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function requireValidKey(key: string): void {
  if (!VALID_CONFIG_KEYS.includes(key as ValidConfigKey)) {
    error(
      "INVALID_KEY",
      `Invalid configuration key: ${key}`,
      `Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`,
    );
  }
}

export async function readConfigValue(key: string): Promise<unknown> {
  requireValidKey(key);
  const config = await getConfig();
  return getNestedValue(config as unknown as Record<string, unknown>, key);
}

export async function writeConfigValue(key: string, rawValue: string): Promise<unknown> {
  requireValidKey(key);

  let parsedValue: string | boolean | number = rawValue;

  if (key === "requestTimeout") {
    parsedValue = parseInt(rawValue, 10);
  }
  if (key === "autoUpdate") {
    const raw = String(rawValue).toLowerCase();
    if (raw === "true") parsedValue = true;
    else if (raw === "false") parsedValue = false;
    else if (raw === "notify") parsedValue = "notify";
    else {
      error("INVALID_VALUE", "autoUpdate must be one of: true, false, notify");
    }
  }

  const userConfig = await loadUserConfig();
  setNestedValue(userConfig as unknown as Record<string, unknown>, key, parsedValue);
  await saveUserConfig(userConfig);
  clearConfigCache();

  return parsedValue;
}

export async function listConfigValues(): Promise<Record<string, unknown>> {
  const config = await getConfig();
  const userConfig = await loadUserConfig();
  return {
    ...config,
    userConfig,
  };
}
