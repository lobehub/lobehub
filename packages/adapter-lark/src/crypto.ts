import { createDecipheriv, createHash } from 'node:crypto';

/**
 * Decrypt Lark event body encrypted with AES-256-CBC.
 * @see https://open.larksuite.com/document/server-docs/event-subscription/event-subscription-configure-/encrypt-key-encryption-configuration-case
 */
export function decryptLarkEvent(encrypted: string, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  const iv = encryptedBuffer.subarray(0, 16);
  const ciphertext = encryptedBuffer.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
