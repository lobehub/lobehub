// Global counter for additional uniqueness
let apiKeyCounter = 0;

/**
 * Generate API Key
 * Format: sk-lh-{random}
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
  return `sk-lh-${randomPart}`;
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
