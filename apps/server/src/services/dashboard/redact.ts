/** Persisted size of each raw stream on a run row. */
export const DASHBOARD_RUN_STREAM_LIMIT = 16 * 1024;

const TRUNCATION_MARKER = '\n…[truncated]';

/** Secret values shorter than this are not redacted: they would shred ordinary text. */
const MIN_SECRET_LENGTH = 6;

/**
 * Well-known token shapes redacted even when they were not injected by us —
 * a script may read a credential from elsewhere and echo it.
 */
const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_\w{20,}\b/g,
  /\bsk-[\w-]{20,}\b/g,
  /\bxox[abprs]-[\w-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

const BEARER_PATTERN = /\b(Bearer)\s+[\w.~+/-]{16,}=*/gi;

/**
 * Replace every occurrence of the injected secret values, then any well-known
 * token shape. Secrets are matched longest first so one secret containing
 * another is removed whole.
 */
export const redactSecrets = (text: string, secrets: Record<string, string> = {}): string => {
  if (!text) return text;

  let result = text;
  const entries = Object.entries(secrets)
    .filter(([, value]) => typeof value === 'string' && value.length >= MIN_SECRET_LENGTH)
    .sort(([, a], [, b]) => b.length - a.length);

  for (const [name, value] of entries) {
    result = result.split(value).join(`[REDACTED:${name}]`);
  }

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  result = result.replaceAll(BEARER_PATTERN, '$1 [REDACTED]');

  return result;
};

/** Keep the head of a stream within `limit` characters, marking the cut. */
export const truncateStream = (text: string, limit = DASHBOARD_RUN_STREAM_LIMIT): string => {
  if (!text || text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
};

/** Redact first so a secret straddling the cut is never half-persisted. */
export const sanitizeStream = (text: string, secrets: Record<string, string> = {}): string =>
  truncateStream(redactSecrets(text, secrets));
