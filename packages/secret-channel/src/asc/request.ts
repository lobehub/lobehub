import { ASC_DEFAULT_TTL_SEC, ASC_MAX_TTL_SEC, ASC_SUITE, ASC_VERSION } from './constants';
import { toBase64Url } from './encoding';
import { AscError } from './errors';
import { fingerprintIdentityKey, signRequest } from './identity';
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
  suite,
  target,
  ttlSec = ASC_DEFAULT_TTL_SEC,
}: CreateRequestParams): AscRequest => {
  if (!Number.isFinite(ttlSec) || ttlSec <= 0 || ttlSec > ASC_MAX_TTL_SEC)
    throw new AscError('INVALID_REQUEST', `ttlSec must be in (0, ${ASC_MAX_TTL_SEC}]`);

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
    ...(suite && suite !== ASC_SUITE ? { suite } : {}),
    target,
    v: ASC_VERSION,
  };

  return { ...unsigned, executor: { ...unsigned.executor, sig: signRequest(unsigned, identity.secretKey) } };
};
