import { error } from "~/utils/output.js";

const CONNECTION_ERROR_MARKERS = [
  "connection",
  "subscription error",
  "authentication required",
  "unauthorized",
  "401",
  "econnrefused",
  "etimedout",
  "enotfound",
  "timeout",
];

export const isConnectionLikeError = (message: string): boolean => {
  const lowered = message.toLowerCase();
  return CONNECTION_ERROR_MARKERS.some((marker) => lowered.includes(marker));
};

export const failWithConnectionOrUnexpected = (message: string): never => {
  if (isConnectionLikeError(message)) {
    error("CONNECTION_ERROR", message);
  }
  error("UNEXPECTED_ERROR", message);
};

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (fallback) return fallback;
  return String(err);
}
