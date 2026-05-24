import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type DaemonEvent = {
  type: string;
  source: "nexus";
  at: string;
  [key: string]: unknown;
};

export type LogLevel = "critical" | "info" | "debug";

export const CRITICAL_EVENTS = new Set([
  "connected",
  "ready",
  "disconnected",
  "reconnecting",
  "reconnected",
  "subscription_applied",
  "subscription_error",
  "auth_failed",
  "heartbeat_failed",
  "heartbeat_recovered",
  "shutdown",
  "action_received",
  "action_started",
  "action_completed",
  "action_failed_infra",
  "harness_spawn_violation",
  "harness_usage_extraction_failed",
]);

export const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  return value;
};

export const nowIso = (): string => new Date().toISOString();

export const sanitizeValue = (value: unknown): unknown => {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  if (typeof value === "bigint") return value.toString();
  try {
    return JSON.parse(JSON.stringify(value, jsonReplacer));
  } catch {
    return String(value);
  }
};

export const resolveLogLevel = (value: unknown): LogLevel => {
  if (value === "critical" || value === "info" || value === "debug") return value;
  return "critical";
};

export const shouldEmit = (eventType: string, level: LogLevel): boolean => {
  if (level === "debug") return true;
  if (CRITICAL_EVENTS.has(eventType)) return true;
  if (level === "info" && eventType.startsWith("heartbeat_")) return true;
  return false;
};

export const resolveLogStream = async (pathValue?: string): Promise<WriteStream | null> => {
  if (!pathValue) return null;
  const absolutePath = resolve(pathValue);
  await mkdir(dirname(absolutePath), { recursive: true });
  return createWriteStream(absolutePath, { flags: "a" });
};

export type EventEmitter = (event: { type: string; [key: string]: unknown }) => void;

export function createEventEmitter(options: {
  logLevel: LogLevel;
  logStream?: WriteStream | null;
  write?: (line: string) => void;
  now?: () => string;
}): EventEmitter {
  const writeLine = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? nowIso;

  const writeEvent = (event: DaemonEvent): void => {
    const line = JSON.stringify(event, jsonReplacer);
    writeLine(line);
    if (options.logStream) options.logStream.write(`${line}\n`);
  };

  return (event) => {
    if (!shouldEmit(event.type, options.logLevel)) return;
    writeEvent({ source: "nexus", at: now(), ...event });
  };
}
