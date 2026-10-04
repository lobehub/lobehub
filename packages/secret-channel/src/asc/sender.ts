/**
 * Sender authentication (spec §6.10): the Client's static X25519 key for HPKE Auth mode, its
 * fingerprint, and the classification that decides which Requests need it.
 */
import { fingerprintIdentityKey } from './identity';
import { fromBase64Url, toBase64Url } from './encoding';

/** Long-term Client key ([ASC-L2-33]). The private key never leaves the Client's device. */
export interface AscClientKey {
  /** Raw 32-byte X25519 private key. */
  privateKey: Uint8Array;
  /** Raw 32-byte X25519 public key, base64url. */
  publicKey: string;
}

/** `SHA256:` + base64url(SHA-256(raw public key)), the same construction as §6.3. */
export const fingerprintClientKey = (publicKey: string): string => fingerprintIdentityKey(publicKey);

/** [ASC-L2-40]: the `sender` member is a clientKeyFp. */
export const isClientKeyFingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^SHA256:[A-Za-z0-9_-]{43}$/.test(value);

/** Paired Client keys as the Executor stores them: clientKeyFp → public key ([ASC-L2-34]). */
export type AscPairedClients = ReadonlyMap<string, string>;

export const pairedClientsFrom = (publicKeys: Iterable<string>): AscPairedClients =>
  new Map([...publicKeys].map((publicKey) => [fingerprintClientKey(publicKey), publicKey]));

/** Validate a base64url X25519 public key given by the Human during pairing. */
export const parseClientPublicKey = (publicKey: string): string => {
  const raw = fromBase64Url(publicKey);
  if (raw.length !== 32) throw new TypeError('a Client public key is 32 bytes');
  return toBase64Url(raw);
};

const VERIFIER_CHECKED_KINDS = new Set(['password', 'passphrase', 'otp']);
const VERIFIER_CHECKED_TARGETS = new Set(['sudo', 'ssh']);

/**
 * [ASC-L2-35]: a Request is verifier-checked when its Sink checks the value against a secret that
 * already exists (password / passphrase / otp for sudo or ssh). Everything else — tokens,
 * approvals, git, env-run, oauth, mcp-url, pty prompts, unknown kinds, and Sinks that set a new
 * secret — is value-accepting and needs sender authentication ([ASC-L2-36]).
 */
export const isVerifierChecked = (kind: string, targetKind: string, options: { setsNewSecret?: boolean } = {}) =>
  !options.setsNewSecret && VERIFIER_CHECKED_KINDS.has(kind) && VERIFIER_CHECKED_TARGETS.has(targetKind);
