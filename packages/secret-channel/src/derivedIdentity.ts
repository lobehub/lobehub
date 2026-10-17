/**
 * LobeHub addition (not vendored): a stable Executor identity derived from a
 * server secret.
 *
 * ASC leaves identity storage to the Executor (spec §6.2). A horizontally
 * scaled, serverless Executor has no single disk to keep a generated key on,
 * so it derives the Ed25519 seed from a secret every instance already shares:
 * HKDF-SHA256(ikm = server secret, salt = "asc/v1/executor-identity", info =
 * executorId). The identity stays the same across instances and deploys —
 * which is what lets clients TOFU-pin its fingerprint — and changes only when
 * the secret is rotated, exactly like any other key rotation.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { utf8Encode } from './asc/encoding';
import { type AscIdentityKeyPair, identityFromSeed } from './asc/identity';

const IDENTITY_SALT = 'asc/v1/executor-identity';

export const deriveIdentityFromSecret = (
  secret: Uint8Array,
  executorId: string,
): AscIdentityKeyPair => {
  if (secret.length < 16) throw new Error('executor identity secret must be at least 128 bits');
  return identityFromSeed(
    hkdf(sha256, secret, utf8Encode(IDENTITY_SALT), utf8Encode(executorId), 32),
  );
};
