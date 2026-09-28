import * as businessConst from '@lobechat/business-const';

/**
 * A distribution's `@lobechat/business-const` override replaces the whole
 * module rather than extending it, so one written before this slot existed
 * simply omits `API_KEY_PREFIX` — that reads as `undefined` here, not as "use
 * upstream's default". Falling back explicitly keeps behaviour identical to
 * before this slot existed instead of crashing every issued key on whatever
 * override the deployment is running.
 */
const configuredApiKeyPrefix = (businessConst as Record<string, unknown>).API_KEY_PREFIX;
export const API_KEY_PREFIX =
  typeof configuredApiKeyPrefix === 'string' ? configuredApiKeyPrefix : 'sk-lh-';

// Global counter for additional uniqueness
let apiKeyCounter = 0;

/**
 * Generate API Key
 * Format: `${API_KEY_PREFIX}{16 lowercase alphanumerics}`
 * @returns Generated API Key
 */
export function generateApiKey(): string {
  // Use high-resolution timestamp for better uniqueness
  const timestamp = performance.now().toString(36).replaceAll('.', '');

  // Generate multiple random components
  const random1 = Math.random().toString(36).slice(2);
  const random2 = Math.random().toString(36).slice(2);
  const random3 = Math.random().toString(36).slice(2);

  // Add a counter-based component for additional uniqueness
  apiKeyCounter = (apiKeyCounter + 1) % 1_000_000;
  const counter = apiKeyCounter.toString(36);

  // Combine all components
  const combined = (timestamp + random1 + random2 + random3 + counter).replaceAll(/[^\da-z]/g, '');

  // Ensure we have enough entropy
  let randomPart = combined.slice(0, 16);

  // If we don't have enough characters, generate more
  while (randomPart.length < 16) {
    const additional = Math.random().toString(36).slice(2);
    randomPart += additional;
  }

  // Take exactly 16 characters
  randomPart = randomPart.slice(0, 16);

  // Combine to form the final API Key
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Check if API Key is expired
 * @param expiresAt - Expiration time
 * @returns Whether the key has expired
 */
export function isApiKeyExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() > expiresAt;
}

/** The random half of a key: exactly 16 lowercase alphanumerics. */
const KEY_SUFFIX_PATTERN = /^[\da-z]{16}$/;

/**
 * Validate API Key format.
 *
 * Prefix compared with `startsWith` rather than interpolated into a RegExp.
 * The prefix is a build-time constant that a distribution overrides, so it is
 * data flowing into a pattern; comparing it directly means there is no escaping
 * to get wrong, and the check stays correct for any prefix somebody chooses.
 *
 * Built from the same constant the generator uses. These two drifting apart is
 * not cosmetic: the OpenAPI auth middleware calls this to decide whether a
 * bearer token is an API key or an OIDC JWT, so a mismatch makes every issued
 * key fail authentication as a malformed JWT instead.
 *
 * @param key - API Key to validate
 * @returns Whether the key has a valid format
 */
export function validateApiKeyFormat(key: string): boolean {
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  return KEY_SUFFIX_PATTERN.test(key.slice(API_KEY_PREFIX.length));
}
