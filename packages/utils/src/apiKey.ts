/**
 * Generate cryptographically secure random string
 * Uses crypto.getRandomValues() instead of Math.random()
 */
function getSecureRandom(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

/**
 * Generate API Key
 * Format: sk-lh-{random}
 * @returns Generated API Key
 */
export function generateApiKey(): string {
  // Generate 16 cryptographically secure random characters
  const randomPart = getSecureRandom(16);

  // Combine to form the final API Key
  return `sk-lh-${randomPart}`;
}

/**
 * Check if API Key is expired
 * @param expiresAt - Expiration time
 * @returns Whether the key is expired
 */
export function isApiKeyExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() > expiresAt;
}

/**
 * Validate API Key format
 * @param key - API Key to validate
 * @returns Whether the key has a valid format
 */
export function validateApiKeyFormat(key: string): boolean {
  // Check format: sk-lh-{random}
  const pattern = /^sk-lh-[\da-z]{16}$/;
  return pattern.test(key);
}
