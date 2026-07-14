/**
 * Cross-platform base64 encoding utility
 * Works in both browser and Node.js environments
 */

import { Buffer } from 'buffer.js';

/**
 * Encode a string to base64
 * @param input - The string to encode
 * @returns Base64 encoded string
 */
export const encodeToBase64 = (input: string): string => {
  if (typeof btoa === 'function') {
    // Browser environment: `btoa` only accepts Latin1 and throws on any code
    // point > U+00FF, so UTF-8-encode first and map each byte to a Latin1 char.
    const bytes = new TextEncoder().encode(input);
    const binary = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
    return btoa(binary);
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
    // Browser environment: `atob` yields a Latin1 binary string, so read the
    // bytes back out and decode them as UTF-8.
    const binary = atob(input);
    const bytes = Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
    return new TextDecoder().decode(bytes);
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
