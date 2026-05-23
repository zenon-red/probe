/** Standard timeout values for shell commands (in milliseconds). */
export const SHELL_TIMEOUT = {
  SHORT: 5_000,
  MEDIUM: 10_000,
  LONG: 30_000,
  VERY_LONG: 120_000,
} as const;

/** Standard timeout values for network requests (in milliseconds). */
export const NETWORK_TIMEOUT = {
  DEFAULT: 30_000,
  DOWNLOAD: 60_000,
} as const;

/** Reconnection backoff configuration (in milliseconds). */
export const RECONNECT = {
  BASE_MS: 1_000,
  MAX_MS: 30_000,
} as const;

/** Heartbeat configuration (in milliseconds). */
export const HEARTBEAT = {
  INTERVAL_MS: 300_000,
  JITTER_MS: 5_000,
} as const;

/** Default harness timeout (in seconds). */
export const HARNESS_TIMEOUT_SECS = 7_200;
