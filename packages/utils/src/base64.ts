/**
 * Cross-platform base64 encoding utility
 * Works in both browser and Node.js environments
 */

/**
 * Encode a string to base64
 * @param input - The string to encode
 * @returns Base64 encoded string
 */
export const encodeToBase64 = (input: string): string => {
  if (typeof btoa === 'function') {
    // Browser environment
    return btoa(input);
  } else {
    // Node.js environment
    return Buffer.from(input, 'utf8').toString('base64');
  }
};

/**
 * Decode a base64 string
 * @param input - The base64 string to decode
 * @returns Decoded string
 */
export const decodeFromBase64 = (input: string): string => {
  if (typeof atob === 'function') {
    // Browser environment
    return atob(input);
  } else {
    // Node.js environment
    return Buffer.from(input, 'base64').toString('utf8');
  }
};

/**
 * Create Basic Authentication header value
 * @param username - Username for authentication
 * @param password - Password for authentication
 * @returns Base64 encoded credentials for Basic auth
 */
export const createBasicAuthCredentials = (username: string, password: string): string => {
  return encodeToBase64(`${username}:${password}`);
};
