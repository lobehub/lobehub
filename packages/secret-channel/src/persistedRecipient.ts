/**
 * LobeHub addition (not vendored): an ephemeral recipient whose private key can
 * be stored between two HTTP requests.
 *
 * The reference {@link EphemeralRecipient} keeps its key in process memory,
 * which assumes the Executor is one long-lived process. A serverless Executor
 * creates the request in one invocation and opens the envelope in another, so
 * it has to persist the key — sealed under its own at-rest key — and destroy
 * that copy *before* it calls {@link openWithPersistedKey}. Everything else
 * mirrors `EphemeralRecipient.open` check for check, with the same error
 * codes, so the conformance properties carry over:
 *
 * - REQUEST_MISMATCH / SENDER_AUTH_REQUIRED fire before any decryption;
 * - EXPIRED is checked against the request's own `expiresAt`;
 * - version / suite / size limits are enforced before HPKE runs;
 * - every failure inside decryption is DECRYPT_FAILED or INVALID_ENVELOPE and
 *   never carries plaintext, ciphertext or key bytes.
 */
import { type AscBindableRequest, encodeRequestAad, requestSuite } from './asc/aad';
import {
  ASC_HPKE_INFO,
  ASC_MAX_CT_B64_LENGTH,
  ASC_MAX_ENC_B64_LENGTH,
  ASC_SUITE_AUTH,
  ASC_VERSION,
} from './asc/constants';
import { fromBase64Url, toBase64Url, utf8Encode, wipe } from './asc/encoding';
import { AscError, isAscError } from './asc/errors';
import { getSuite, unframePlaintext } from './asc/hpke';
import type { AscEnvelope } from './asc/types';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export interface PersistableRecipientKey {
  /** Raw X25519 private key, base64url. Seal it at rest; never log it. */
  privateKey: string;
  /** Raw X25519 public key, base64url — the request's `executor.ephPub`. */
  publicKey: string;
}

/** A fresh per-request X25519 key pair from the CSPRNG (spec §6.2). */
export const generatePersistableRecipientKey = async (): Promise<PersistableRecipientKey> => {
  const suite = getSuite();
  const keyPair = await suite.kem.generateKeyPair();
  return {
    privateKey: toBase64Url(
      new Uint8Array(await suite.kem.serializePrivateKey(keyPair.privateKey)),
    ),
    publicKey: toBase64Url(new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey))),
  };
};

export interface OpenWithPersistedKeyParams {
  envelope: AscEnvelope;
  /** The key taken from storage. The caller MUST already have destroyed the stored copy. */
  key: PersistableRecipientKey;
  now?: number;
  /** The Executor's own copy of the request (never the client's). */
  request: AscBindableRequest;
}

/**
 * Open an envelope with a key that was persisted between requests. Base suite
 * only: the server-side Executor holds no paired Client keys, so an
 * Auth-suite request cannot be opened here and is refused up front.
 */
export const openWithPersistedKey = async ({
  envelope,
  key,
  now = Date.now(),
  request,
}: OpenWithPersistedKeyParams): Promise<Uint8Array> => {
  if (envelope.requestId !== request.id) throw new AscError('REQUEST_MISMATCH');
  if (request.executor.ephPub !== key.publicKey)
    throw new AscError('REQUEST_MISMATCH', 'ephemeral key does not belong to request');
  if (requestSuite(request) === ASC_SUITE_AUTH) throw new AscError('SENDER_AUTH_REQUIRED');
  if (now > request.expiresAt) throw new AscError('EXPIRED');

  if (envelope.v !== ASC_VERSION || envelope.suite !== requestSuite(request))
    throw new AscError('UNSUPPORTED_VERSION');
  if ('sender' in envelope) throw new AscError('INVALID_ENVELOPE');
  if (
    typeof envelope.enc !== 'string' ||
    typeof envelope.ct !== 'string' ||
    envelope.enc.length > ASC_MAX_ENC_B64_LENGTH ||
    envelope.ct.length > ASC_MAX_CT_B64_LENGTH
  )
    throw new AscError('INVALID_ENVELOPE');

  const suite = getSuite();
  const privateBytes = fromBase64Url(key.privateKey);
  let framed: Uint8Array;
  try {
    const recipientKey = {
      privateKey: await suite.kem.deserializePrivateKey(toArrayBuffer(privateBytes)),
      publicKey: await suite.kem.deserializePublicKey(toArrayBuffer(fromBase64Url(key.publicKey))),
    };
    framed = new Uint8Array(
      await suite.open(
        {
          enc: toArrayBuffer(fromBase64Url(envelope.enc)),
          info: toArrayBuffer(utf8Encode(ASC_HPKE_INFO)),
          recipientKey,
        },
        toArrayBuffer(fromBase64Url(envelope.ct)),
        toArrayBuffer(encodeRequestAad(request)),
      ),
    );
  } catch (error) {
    if (isAscError(error)) throw error;
    throw new AscError('DECRYPT_FAILED');
  } finally {
    wipe(privateBytes);
  }

  try {
    return unframePlaintext(framed);
  } catch (error) {
    if (isAscError(error)) throw error;
    throw new AscError('INVALID_ENVELOPE');
  } finally {
    wipe(framed);
  }
};
