/**
 * Convert string to Uint8Array (UTF-8 encoding)
 */
const stringToUint8Array = (str: string): Uint8Array => {
  return new TextEncoder().encode(str);
};

/**
 * Perform XOR operation on Uint8Array
 * @param data The Uint8Array to process
 * @param key The key used for XOR operation (Uint8Array)
 * @returns The Uint8Array after XOR operation
 */
const xorProcess = (data: Uint8Array, key: Uint8Array): Uint8Array => {
  const result = new Uint8Array(data.length);
  for (const [i, datum] of data.entries()) {
    result[i] = datum ^ key[i % key.length]; // Key is used cyclically
  }
  return result;
};

/**
 * Obfuscate payload with XOR and encode to Base64
 * @param payload The JSON object to obfuscate
 * @param secretKey The key used for XOR obfuscation
 * @returns The obfuscated string encoded in Base64
 */
export const obfuscatePayloadWithXOR = <T>(payload: T, secretKey: string): string => {
  const jsonString = JSON.stringify(payload);
  const dataBytes = stringToUint8Array(jsonString);
  const keyBytes = stringToUint8Array(secretKey);

  const xoredBytes = xorProcess(dataBytes, keyBytes);

  // Convert Uint8Array to Base64 string
  // In browser environment, btoa can only handle Latin-1 characters, so we need to convert to a format suitable for btoa first
  return btoa(String.fromCharCode(...xoredBytes));
};
