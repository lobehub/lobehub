/** Discord API allows max 100 messages per request. */
export const MAX_DISCORD_HISTORY_LIMIT = 100;

export const DEFAULT_DISCORD_CONNECTION_MODE = 'websocket';

// --------------- Credential formats ---------------
//
// Operators routinely paste the wrong value into these fields — an OAuth
// authorize URL, a LobeHub `sk-lh-…` API key, even a block of prose — and the
// bot then fails to connect with no obvious cause. The patterns below are
// deliberately shape-checks, not authenticity checks: they reject values that
// could never work while staying loose enough to survive Discord widening its
// own formats.

/** Ed25519 public key — always exactly 64 hex characters. */
export const DISCORD_PUBLIC_KEY_PATTERN = String.raw`^[\dA-Fa-f]{64}$`;

/**
 * Bot token — three base64url segments (`appId.timestamp.hmac`). Segment
 * lengths are given generous lower bounds because Discord has lengthened them
 * before; a real token has never been anywhere near this short.
 */
export const DISCORD_BOT_TOKEN_PATTERN = String.raw`^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$`;

/** Application ID — a Discord snowflake. */
export const DISCORD_APPLICATION_ID_PATTERN = String.raw`^\d{17,20}$`;
