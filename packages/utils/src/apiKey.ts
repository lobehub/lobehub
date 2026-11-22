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

/**
 * Total length of a newly issued key, prefix included. A prefix too long to
 * leave {@link MIN_KEY_SUFFIX_LENGTH} random characters lengthens the key instead.
 */
export const API_KEY_LENGTH = 64;

/** Random-part length of keys issued before {@link API_KEY_LENGTH}; they stay valid. */
const LEGACY_KEY_SUFFIX_LENGTH = 16;

/** Random characters every new key keeps (about 165 bits), whatever the prefix. */
const MIN_KEY_SUFFIX_LENGTH = 32;

const KEY_SUFFIX_LENGTH = Math.max(API_KEY_LENGTH - API_KEY_PREFIX.length, MIN_KEY_SUFFIX_LENGTH);
const KEY_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
// Largest multiple of the alphabet size in a byte; higher bytes are discarded
// so that `byte % 36` stays uniform.
const MAX_UNBIASED_BYTE = 256 - (256 % KEY_ALPHABET.length);

/**
 * Generate API Key
 * Format: `${API_KEY_PREFIX}{lowercase alphanumerics}`, {@link API_KEY_LENGTH} characters in total
 * unless the prefix needs the key to be longer
 * @returns Generated API Key
 */
export function generateApiKey(): string {
  let randomPart = '';

  while (randomPart.length < KEY_SUFFIX_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(KEY_SUFFIX_LENGTH))) {
      if (byte >= MAX_UNBIASED_BYTE) continue;
      randomPart += KEY_ALPHABET[byte % KEY_ALPHABET.length];
      if (randomPart.length === KEY_SUFFIX_LENGTH) break;
    }
  }

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

/** The random half of a key: lowercase alphanumerics only. */
const KEY_SUFFIX_PATTERN = /^[\da-z]+$/;

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

  const suffix = key.slice(API_KEY_PREFIX.length);
  if (suffix.length !== KEY_SUFFIX_LENGTH && suffix.length !== LEGACY_KEY_SUFFIX_LENGTH) {
    return false;
  }
  return KEY_SUFFIX_PATTERN.test(suffix);
}
