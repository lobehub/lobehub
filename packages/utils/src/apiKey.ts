// Global counter for additional uniqueness
let apiKeyCounter = 0;

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
