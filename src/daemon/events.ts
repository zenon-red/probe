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
  "action_queued",
  "action_queue_abandoned",
  "harness_spawn_violation",
  "harness_usage_extraction_failed",
  "report_action_run_failed",
  "sidecar_write_failed",
  "module_dispatch",
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

export type EventSubscriber = (event: DaemonEvent) => void;

export type EventBus = {
  emit: (event: { type: string; [key: string]: unknown }) => void;
  subscribe: (subscriber: EventSubscriber) => () => void;
};

export type EventEmitter = EventBus["emit"];

export function createEventBus(options: {
  logLevel: LogLevel;
  logStream?: WriteStream | null;
  write?: (line: string) => void;
  now?: () => string;
}): EventBus {
  const writeLine = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? nowIso;
  const subscribers = new Set<EventSubscriber>();

  const deliver = (event: DaemonEvent): void => {
    for (const subscriber of subscribers) {
      subscriber(event);
    }
  };

  const emit: EventEmitter = (event) => {
    if (!shouldEmit(event.type, options.logLevel)) return;
    const envelope: DaemonEvent = { source: "nexus", at: now(), ...event };
    deliver(envelope);
  };

  const subscribe = (subscriber: EventSubscriber): (() => void) => {
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  };

  subscribe((event) => {
    const line = JSON.stringify(event, jsonReplacer);
    writeLine(line);
    if (options.logStream) options.logStream.write(`${line}\n`);
  });

  return { emit, subscribe };
}

export function createEventEmitter(options: {
  logLevel: LogLevel;
  logStream?: WriteStream | null;
  write?: (line: string) => void;
  now?: () => string;
}): EventEmitter {
  return createEventBus(options).emit;
}
