import { createPrivateKey, sign } from 'node:crypto';

/**
 * PKCS8 DER prefix for Ed25519 private keys.
 *
 * ASN.1 structure:
 *   SEQUENCE {
 *     INTEGER 0 (version)
 *     SEQUENCE { OID 1.3.101.112 (Ed25519) }
 *     OCTET STRING { OCTET STRING { <32-byte seed> } }
 *   }
 */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * Sign the webhook verification response using Ed25519.
 *
 * QQ Bot webhook verification requires:
 * 1. Repeat the clientSecret until >= 32 bytes, then truncate to 32 as the seed
 * 2. Create an Ed25519 private key from the seed
 * 3. Sign the concatenated message (eventTs + plainToken)
 * 4. Return the signature as a hex string
 */
export function signWebhookResponse(
  eventTs: string,
  plainToken: string,
  clientSecret: string,
): string {
  // QQ requires: repeat the secret string until length >= 32, then truncate to 32 bytes
  let seedStr = clientSecret;
  while (seedStr.length < 32) {
    seedStr = seedStr.repeat(2);
  }
  const seed = Buffer.from(seedStr.slice(0, 32), 'utf8');

  // Build PKCS8 DER key — Node.js derives the public key from the seed automatically
  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privateKey = createPrivateKey({ format: 'der', key: pkcs8Der, type: 'pkcs8' });

  // Sign the message
  const message = Buffer.from(eventTs + plainToken);
  const signature = sign(null, message, privateKey);

  return signature.toString('hex');
}
