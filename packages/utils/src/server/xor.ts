import type { ClientSecretPayload } from '@lobechat/types';

import { SECRET_XOR_KEY } from '@/envs/auth';

/**
 * Convert Base64 string to Uint8Array
 */
const base64ToUint8Array = (base64: string): Uint8Array => {
  // Use Buffer directly in Node.js environment
  return Buffer.from(base64, 'base64');
};

/**
 * Perform XOR operation on Uint8Array (same as the client-side xorProcess function)
 */
const xorProcess = (data: Uint8Array, key: Uint8Array): Uint8Array => {
  const result = new Uint8Array(data.length);
  for (const [i, datum] of data.entries()) {
    result[i] = datum ^ key[i % key.length];
  }
  return result;
};

/**
 * Convert Uint8Array to string (UTF-8 decoding)
 */
const uint8ArrayToString = (arr: Uint8Array): string => {
  return new TextDecoder().decode(arr);
};

export const getXorPayload = (token: string): ClientSecretPayload => {
  const keyBytes = new TextEncoder().encode(SECRET_XOR_KEY);

  // 1. Base64 decoding
  const base64DecodedBytes = base64ToUint8Array(token);

  // 2. XOR deobfuscation
  const xorDecryptedBytes = xorProcess(base64DecodedBytes, keyBytes);

  // 3. Convert to string and parse JSON
  const decodedJsonString = uint8ArrayToString(xorDecryptedBytes);

  return JSON.parse(decodedJsonString) as ClientSecretPayload;
};
