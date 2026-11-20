import {
  ASC_DEFAULT_TTL_SEC,
  ASC_MAX_TTL_SEC,
  ASC_SUITE,
  ASC_SUITE_AUTH,
  ASC_VERSION,
} from './constants';
import { toBase64Url } from './encoding';
import { AscError } from './errors';
import { fingerprintIdentityKey, signRequest } from './identity';
import { isVerifierChecked } from './sender';
import type { AscRequest } from './types';

/** 128 random bits, base64url (spec §5.1). */
export const generateRequestId = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(16)));

export interface CreateRequestParams extends Pick<
  AscRequest,
  'kind' | 'label' | 'purpose' | 'requester' | 'suite' | 'target'
> {
  ephPub: string;
  executor: { executorId: string; executorName: string };
  /** Injected for test vectors only; defaults to a fresh random id. */
  id?: string;
  identity: { publicKey: string; secretKey: Uint8Array };
  now?: number;
  /**
   * [ASC-L2-35]: the Sink writes a new secret instead of checking one that already exists, which
   * makes the Request value-accepting even for a `password` / `passphrase` / `otp` kind.
   */
  setsNewSecret?: boolean;
  ttlSec?: number;
}

/** Executor side: assemble a request and sign its binding (spec §6.5). */
export const createRequest = ({
  ephPub,
  executor,
  id = generateRequestId(),
  identity,
  kind,
  label,
  now = Date.now(),
  purpose,
  requester,
  setsNewSecret,
  suite,
  target,
  ttlSec = ASC_DEFAULT_TTL_SEC,
}: CreateRequestParams): AscRequest => {
  if (!Number.isFinite(ttlSec) || ttlSec <= 0 || ttlSec > ASC_MAX_TTL_SEC)
    throw new AscError('INVALID_REQUEST', `ttlSec must be in (0, ${ASC_MAX_TTL_SEC}]`);

  // [ASC-L2-36]: a value-accepting Request MUST carry the Auth suite, whether or not a Client is
  // paired. Base mode is only sound when the Sink checks the value against a secret that already
  // exists ([ASC-L2-37]), so a value-accepting Request never falls back to it ([ASC-EXT-07]).
  const requestSuiteLabel = isVerifierChecked(kind, target.kind, { setsNewSecret })
    ? suite
    : ASC_SUITE_AUTH;

  const unsigned: AscRequest = {
    createdAt: now,
    executor: {
      ephPub,
      executorId: executor.executorId,
      executorName: executor.executorName,
      identityKeyFp: fingerprintIdentityKey(identity.publicKey),
      identityPublicKey: identity.publicKey,
      sig: '',
    },
    expiresAt: now + Math.floor(ttlSec * 1000),
    id,
    kind,
    label,
    persistence: 'once',
    purpose,
    requester,
    // Omitted for the Base suite so that Base Requests keep their draft-00 shape (spec §6.10).
    ...(requestSuiteLabel && requestSuiteLabel !== ASC_SUITE ? { suite: requestSuiteLabel } : {}),
    target,
    v: ASC_VERSION,
  };

  return { ...unsigned, executor: { ...unsigned.executor, sig: signRequest(unsigned, identity.secretKey) } };
};
