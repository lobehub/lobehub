/**
 * Cross-platform base64 encoding utility
 * Works in both browser and Node.js environments
 */

import { Buffer } from 'buffer.js';

/**
 * Encode raw bytes to base64
 * @param bytes - The bytes to encode
 * @returns Base64 encoded string
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa === 'function') {
    // Browser environment: `btoa` wants a Latin1 binary string; build it in
    // chunks because `String.fromCharCode(...bytes)` overflows the argument
    // limit on large payloads.
    let binary = '';
    const chunkSize = 8192;
    for (let index = 0; index < bytes.byteLength; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  } else {
    // Node.js environment
    return Buffer.from(bytes).toString('base64');
  }
};

/**
 * Decode a base64 string to raw bytes
 * @param input - The base64 string to decode
 * @returns Decoded bytes
 */
export const base64ToBytes = (input: string): Uint8Array => {
  if (typeof atob === 'function') {
    // Browser environment: `atob` yields a Latin1 binary string, one char per byte.
    const binary = atob(input);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } else {
    // Node.js environment
    return new Uint8Array(Buffer.from(input, 'base64'));
  }
};

/**
 * Encode a string to base64
 * @param input - The string to encode
 * @returns Base64 encoded string
 */
export const encodeToBase64 = (input: string): string =>
  bytesToBase64(new TextEncoder().encode(input));

/**
 * Decode a base64 string
 * @param input - The base64 string to decode
 * @returns Decoded string
 */
export const decodeFromBase64 = (input: string): string =>
  new TextDecoder().decode(base64ToBytes(input));

/**
 * Create Basic Authentication header value
 * @param username - Username for authentication
 * @param password - Password for authentication
 * @returns Base64 encoded credentials for Basic auth
 */
export const createBasicAuthCredentials = (username: string, password: string): string => {
  return encodeToBase64(`${username}:${password}`);
};
