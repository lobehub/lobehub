/** Default debounce window (ms) for message batching. */
export const DEFAULT_BOT_DEBOUNCE_MS = 2000;

/** Maximum debounce window (ms) allowed across all platforms. */
export const MAX_BOT_DEBOUNCE_MS = 30_000;

/** Default number of messages to read from channel history. */
export const DEFAULT_BOT_HISTORY_LIMIT = 50;

/**
 * Maximum number of messages allowed at the interface layer.
 * This is the upper bound across all platforms (Slack supports up to 999).
 * Each platform service clamps to its own API limit.
 */
export const MAX_BOT_HISTORY_LIMIT = 999;

/** Minimum number of messages allowed for history limit. */
export const MIN_BOT_HISTORY_LIMIT = 1;
