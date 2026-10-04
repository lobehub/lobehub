import { Aes256Gcm, CipherSuite, HkdfSha256 } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';

import { type AscBindableRequest, encodeRequestAad, requestSuite } from './aad';
import {
  ASC_HPKE_INFO,
  ASC_MAX_CT_B64_LENGTH,
  ASC_MAX_ENC_B64_LENGTH,
  ASC_MAX_SECRET_BYTES,
  ASC_PAD_BLOCK,
  ASC_SUITE,
  ASC_SUITE_AUTH,
  ASC_VERSION,
} from './constants';
import { fromBase64Url, toBase64Url, utf8Encode, wipe } from './encoding';
import { AscError, isAscError } from './errors';
import { type AscTrustCheck, verifyRequest } from './identity';
import { type AscClientKey, type AscPairedClients, fingerprintClientKey, isClientKeyFingerprint } from './sender';
import type { AscEnvelope } from './types';

/**
 * HPKE Base or Auth mode, DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM (spec §6.1).
 * The X25519 KEM is pure JS so behaviour does not depend on WebCrypto X25519 support.
 */
const createSuite = () =>
  new CipherSuite({
    aead: new Aes256Gcm(),
    kdf: new HkdfSha256(),
    kem: new DhkemX25519HkdfSha256(),
  });

let suiteSingleton: CipherSuite | undefined;
export const getSuite = () => (suiteSingleton ??= createSuite());

const HPKE_INFO = utf8Encode(ASC_HPKE_INFO);

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// ─── Plaintext framing (spec §6.6): 0x01 ‖ u16be(len) ‖ secret ‖ 0x00… to a multiple of 256 ───

const FRAME_VERSION = 0x01;
const FRAME_HEADER = 3;

export const framePlaintext = (secret: Uint8Array): Uint8Array => {
  if (secret.length === 0) throw new AscError('INVALID_REQUEST', 'empty secret');
  if (secret.length > ASC_MAX_SECRET_BYTES) throw new AscError('SECRET_TOO_LARGE');

  const size = Math.ceil((secret.length + FRAME_HEADER) / ASC_PAD_BLOCK) * ASC_PAD_BLOCK;
  const framed = new Uint8Array(size);
  framed[0] = FRAME_VERSION;
  framed[1] = (secret.length >> 8) & 0xff;
  framed[2] = secret.length & 0xff;
  framed.set(secret, FRAME_HEADER);
  return framed;
};

export const unframePlaintext = (framed: Uint8Array): Uint8Array => {
  if (framed.length < ASC_PAD_BLOCK || framed.length % ASC_PAD_BLOCK !== 0)
    throw new AscError('INVALID_ENVELOPE', 'bad padded length');
  if (framed[0] !== FRAME_VERSION) throw new AscError('UNSUPPORTED_VERSION');

  const length = (framed[1] << 8) | framed[2];
  if (length === 0 || length > framed.length - FRAME_HEADER)
    throw new AscError('INVALID_ENVELOPE', 'bad secret length');

  let padding = 0;
  for (let i = FRAME_HEADER + length; i < framed.length; i++) padding |= framed[i];
  if (padding !== 0) throw new AscError('INVALID_ENVELOPE', 'non-zero padding');

  return framed.slice(FRAME_HEADER, FRAME_HEADER + length);
};

// ─── Client key (spec §6.10) ─────────────────────────────────────────────────────────────────

const exportKeyPair = async (keyPair: HpkeKeyPair): Promise<AscClientKey> => {
  const suite = getSuite();
  return {
    privateKey: new Uint8Array(await suite.kem.serializePrivateKey(keyPair.privateKey)),
    publicKey: toBase64Url(new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey))),
  };
};

/** [ASC-L2-33]: a fresh Client key from a CSPRNG. */
export const generateClientKey = async (): Promise<AscClientKey> => exportKeyPair(await getSuite().kem.generateKeyPair());

/** Test-vector hook ONLY: Client key = DeriveKeyPair(ikmS) (RFC 9180 §7.1.3). */
export const clientKeyFromIkm = async (ikmS: Uint8Array): Promise<AscClientKey> =>
  exportKeyPair(await getSuite().kem.deriveKeyPair(toArrayBuffer(ikmS)));

const importClientKey = async (key: AscClientKey) => {
  const suite = getSuite();
  return {
    privateKey: await suite.kem.deserializePrivateKey(toArrayBuffer(key.privateKey)),
    publicKey: await suite.kem.deserializePublicKey(toArrayBuffer(fromBase64Url(key.publicKey))),
  };
};

// ─── Client: seal ────────────────────────────────────────────────────────────────────────────

export interface SealParams {
  /**
   * Test-vector hook ONLY: HPKE `ikmE` for DeriveKeyPair of the sender ephemeral key
   * (RFC 9180 §7.1.3). Production callers MUST NOT pass it (spec §6.2).
   */
  deterministicIkmE?: Uint8Array;
  now?: number;
  request: AscBindableRequest;
  secret: Uint8Array;
  /** This Client's key; required for an Auth-suite Request ([ASC-L2-39]). */
  sender?: AscClientKey;
  trust?: AscTrustCheck;
}

export const sealSecret = async ({
  deterministicIkmE,
  now = Date.now(),
  request,
  secret,
  sender,
  trust,
}: SealParams): Promise<AscEnvelope> => {
  const suiteLabel = requestSuite(request);
  // [ASC-L2-39]: never seal under a suite this Client does not implement.
  if (suiteLabel !== ASC_SUITE && suiteLabel !== ASC_SUITE_AUTH) throw new AscError('UNSUPPORTED_VERSION');
  if (now >= request.expiresAt) throw new AscError('EXPIRED');

  verifyRequest(request, trust);

  const auth = suiteLabel === ASC_SUITE_AUTH;
  // [ASC-L2-39]: an Auth-suite Request needs this Client's key; there is no fallback to Base.
  if (auth && !sender) throw new AscError('SENDER_AUTH_REQUIRED', 'this Client holds no Client key');

  const suite = getSuite();
  const framed = framePlaintext(secret);
  try {
    const recipientPublicKey = await suite.kem.deserializePublicKey(
      toArrayBuffer(fromBase64Url(request.executor.ephPub)),
    );
    const { ct, enc } = await suite.seal(
      {
        info: toArrayBuffer(HPKE_INFO),
        recipientPublicKey,
        ...(auth ? { senderKey: await importClientKey(sender!) } : {}),
        ...(deterministicIkmE ? { ekm: toArrayBuffer(deterministicIkmE) } : {}),
      },
      toArrayBuffer(framed),
      toArrayBuffer(encodeRequestAad(request)),
    );
    return {
      ct: toBase64Url(new Uint8Array(ct)),
      enc: toBase64Url(new Uint8Array(enc)),
      requestId: request.id,
      ...(auth ? { sender: fingerprintClientKey(sender!.publicKey) } : {}),
      suite: auth ? ASC_SUITE_AUTH : ASC_SUITE,
      v: ASC_VERSION,
    };
  } finally {
    wipe(framed);
  }
};

// ─── Executor: one ephemeral recipient per request, single use (spec §6.7) ───────────────────

export type EphemeralRecipientState = 'pending' | 'consumed' | 'expired' | 'destroyed';

type HpkeKeyPair = Awaited<ReturnType<CipherSuite['kem']['generateKeyPair']>>;

export class EphemeralRecipient {
  readonly publicKey: string;
  private keyPair: HpkeKeyPair | undefined;
  private _state: EphemeralRecipientState = 'pending';

  private constructor(keyPair: HpkeKeyPair, publicKey: string) {
    this.keyPair = keyPair;
    this.publicKey = publicKey;
  }

  /**
   * `deterministicIkmR` is a test-vector hook ONLY (RFC 9180 DeriveKeyPair). Production callers
   * MUST NOT pass it: the key has to come from a CSPRNG (spec §6.2).
   */
  static async create(deterministicIkmR?: Uint8Array): Promise<EphemeralRecipient> {
    const suite = getSuite();
    const keyPair = deterministicIkmR
      ? await suite.kem.deriveKeyPair(toArrayBuffer(deterministicIkmR))
      : await suite.kem.generateKeyPair();
    const publicKey = toBase64Url(
      new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey)),
    );
    return new EphemeralRecipient(keyPair, publicKey);
  }

  get state(): EphemeralRecipientState {
    return this._state;
  }

  /**
   * Decrypt `envelope` for the Executor's own copy of `request`. Errors: REQUEST_MISMATCH,
   * SENDER_AUTH_REQUIRED, UNKNOWN_SENDER (none of them consumes the key), REPLAYED, EXPIRED,
   * UNSUPPORTED_VERSION, INVALID_ENVELOPE, DECRYPT_FAILED. Every attempt that reaches decryption
   * consumes the key first (fail closed). `pairedClients` is the Executor's own set of paired
   * Client keys ([ASC-L2-34]); an Auth-suite Request opens only with one of them ([ASC-L2-38]).
   */
  async open(
    request: AscBindableRequest,
    envelope: AscEnvelope,
    now: number = Date.now(),
    pairedClients: AscPairedClients = new Map(),
  ) {
    if (envelope.requestId !== request.id) throw new AscError('REQUEST_MISMATCH');
    if (request.executor.ephPub !== this.publicKey)
      throw new AscError('REQUEST_MISMATCH', 'ephemeral key does not belong to request');

    if (this._state !== 'pending' || !this.keyPair)
      throw new AscError(this._state === 'expired' ? 'EXPIRED' : 'REPLAYED', `recipient is ${this._state}`);

    if (now > request.expiresAt) {
      this.drop('expired');
      throw new AscError('EXPIRED');
    }

    // [ASC-L2-38]: an Auth-suite Request accepts only an Auth Envelope from a paired Client. These
    // checks precede consumption, like REQUEST_MISMATCH: nothing is decrypted, so a Relay that
    // injects its own Envelope learns nothing and cannot pre-empt the paired Client's answer.
    const auth = requestSuite(request) === ASC_SUITE_AUTH;
    let senderPublicKey: string | undefined;
    if (auth) {
      if (envelope.suite !== ASC_SUITE_AUTH || envelope.sender === undefined)
        throw new AscError('SENDER_AUTH_REQUIRED');
      senderPublicKey = isClientKeyFingerprint(envelope.sender) ? pairedClients.get(envelope.sender) : undefined;
      if (!senderPublicKey) throw new AscError('UNKNOWN_SENDER');
    }

    const keyPair = this.keyPair;
    this.drop('consumed');

    try {
      if (envelope.v !== ASC_VERSION || envelope.suite !== requestSuite(request))
        throw new AscError('UNSUPPORTED_VERSION');
      // [ASC-L2-40]: `sender` only with the Auth suite.
      if (!auth && 'sender' in envelope) throw new AscError('INVALID_ENVELOPE');
      if (
        typeof envelope.enc !== 'string' ||
        typeof envelope.ct !== 'string' ||
        envelope.enc.length > ASC_MAX_ENC_B64_LENGTH ||
        envelope.ct.length > ASC_MAX_CT_B64_LENGTH
      )
        throw new AscError('INVALID_ENVELOPE');

      let framed: Uint8Array;
      try {
        framed = new Uint8Array(
          await getSuite().open(
            {
              enc: toArrayBuffer(fromBase64Url(envelope.enc)),
              info: toArrayBuffer(HPKE_INFO),
              recipientKey: keyPair,
              ...(senderPublicKey
                ? { senderPublicKey: await getSuite().kem.deserializePublicKey(toArrayBuffer(fromBase64Url(senderPublicKey))) }
                : {}),
            },
            toArrayBuffer(fromBase64Url(envelope.ct)),
            toArrayBuffer(encodeRequestAad(request)),
          ),
        );
      } catch (error) {
        if (isAscError(error)) throw error;
        throw new AscError('DECRYPT_FAILED');
      }

      try {
        return unframePlaintext(framed);
      } finally {
        wipe(framed);
      }
    } catch (error) {
      if (isAscError(error)) throw error;
      throw new AscError('INVALID_ENVELOPE');
    }
  }

  /** Drop the private key without using it (denied / cancelled / expired / run ended). */
  destroy() {
    if (this._state === 'pending') this.drop('destroyed');
    else this.keyPair = undefined;
  }

  private drop(state: EphemeralRecipientState) {
    this.keyPair = undefined;
    this._state = state;
  }
}
