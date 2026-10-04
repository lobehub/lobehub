import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { type AscBindableRequest, encodeRequestAad } from './aad';
import { ASC_SIGNATURE_CONTEXT } from './constants';
import { bytesEqual, concatBytes, fromBase64Url, toBase64Url, utf8Encode } from './encoding';
import { AscError } from './errors';

/** Long-term Executor identity (spec §6.2). Storage is the Executor's responsibility. */
export interface AscIdentityKeyPair {
  /** Raw 32-byte Ed25519 public key, base64url. */
  publicKey: string;
  /** Raw 32-byte Ed25519 seed. */
  secretKey: Uint8Array;
}

export const generateIdentity = (): AscIdentityKeyPair => {
  const { publicKey, secretKey } = ed25519.keygen();
  return { publicKey: toBase64Url(publicKey), secretKey };
};

export const identityFromSeed = (seed: Uint8Array): AscIdentityKeyPair => ({
  publicKey: toBase64Url(ed25519.getPublicKey(seed)),
  secretKey: seed,
});

/** `SHA256:` + base64url(SHA-256(raw public key)) (spec §6.3). */
export const fingerprintIdentityKey = (publicKey: string): string =>
  `SHA256:${toBase64Url(sha256(fromBase64Url(publicKey)))}`;

/** First 80 bits of the fingerprint as five upper-case hex groups (spec §6.3). */
export const formatFingerprintForDisplay = (fingerprint: string): string => {
  const raw = fromBase64Url(fingerprint.replace(/^SHA256:/, '')).slice(0, 10);
  const hex = [...raw].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
};

/** spec §6.5: the signed message is the context label followed by the canonical AAD. */
export const signatureMessage = (request: AscBindableRequest) =>
  concatBytes(utf8Encode(ASC_SIGNATURE_CONTEXT), encodeRequestAad(request));

export const signRequest = (request: AscBindableRequest, secretKey: Uint8Array): string =>
  toBase64Url(ed25519.sign(signatureMessage(request), secretKey));

export interface AscTrustCheck {
  /** Fingerprint pinned by this Client for `executor.executorId`, if any (spec §6.3). */
  pinnedFingerprint?: string;
}

/** Client side, before sealing (spec §6.5). Throws FINGERPRINT_MISMATCH / BAD_SIGNATURE. */
export const verifyRequest = (request: AscBindableRequest, { pinnedFingerprint }: AscTrustCheck = {}) => {
  const { identityPublicKey, identityKeyFp, sig } = request.executor;

  if (fingerprintIdentityKey(identityPublicKey) !== identityKeyFp)
    throw new AscError('FINGERPRINT_MISMATCH', 'identityKeyFp does not match identity key');

  if (
    pinnedFingerprint !== undefined &&
    !bytesEqual(utf8Encode(pinnedFingerprint), utf8Encode(identityKeyFp))
  )
    throw new AscError('FINGERPRINT_MISMATCH', 'executor identity changed since pinning');

  let ok = false;
  try {
    ok = ed25519.verify(fromBase64Url(sig), signatureMessage(request), fromBase64Url(identityPublicKey));
  } catch {
    ok = false;
  }
  if (!ok) throw new AscError('BAD_SIGNATURE');
};
