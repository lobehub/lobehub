import { sha256 } from '@noble/hashes/sha2.js';

import { ASC_AAD_MAGIC, ASC_SUITE, ASC_VERSION } from './constants';
import { encodeFields, toBase64Url } from './encoding';
import { AscError } from './errors';
import type { AscRequest } from './types';

/** The 14 bound values, in AAD order (spec §6.4.1). */
export interface AscAadBinding {
  argvHash: string;
  displayHash: string;
  ephPub: string;
  executorId: string;
  exePath: string;
  expiresAt: number;
  identityKeyFp: string;
  kind: string;
  requestId: string;
  runId: string;
  suite: string;
  targetKind: string;
  v: number;
}

/** The Request fields a receiver binds before trusting it: the AAD inputs plus `v` ([ASC-EXT-02]). */
export type AscBindableRequest = Pick<
  AscRequest,
  | 'executor'
  | 'expiresAt'
  | 'id'
  | 'kind'
  | 'label'
  | 'purpose'
  | 'requester'
  | 'suite'
  | 'target'
  | 'v'
>;

/** The Request's suite label (spec §6.10): the `suite` member, or the Base suite when absent. */
export const requestSuite = (request: Pick<AscRequest, 'suite'>): string => request.suite ?? ASC_SUITE;

/** spec §6.4.2: SHA-256 over u32 count ‖ (u32 len ‖ UTF-8 arg)*, base64url. */
export const hashArgv = (argv: readonly string[]): string =>
  toBase64Url(sha256(encodeFields([...argv])));

/** spec §6.4.3: everything the Host shows as "system observed" is covered by the signature. */
export const hashDisplay = (
  request: Pick<AscRequest, 'executor' | 'label' | 'purpose' | 'target'>,
): string =>
  toBase64Url(
    sha256(
      encodeFields([
        request.target.argvDisplay,
        request.target.promptText ?? '',
        request.target.verification,
        request.purpose.systemObserved,
        request.executor.executorName,
        request.label,
      ]),
    ),
  );

export const aadBindingFromRequest = (request: AscBindableRequest): AscAadBinding => ({
  argvHash: request.target.argvHash,
  displayHash: hashDisplay(request),
  ephPub: request.executor.ephPub,
  executorId: request.executor.executorId,
  exePath: request.target.exePath,
  expiresAt: request.expiresAt,
  identityKeyFp: request.executor.identityKeyFp,
  kind: request.kind,
  requestId: request.id,
  runId: request.requester.runId,
  suite: requestSuite(request),
  targetKind: request.target.kind,
  v: ASC_VERSION,
});

/** Field names in AAD order; index 0 is the magic. Used by tests and test vectors. */
export const AAD_FIELD_ORDER = [
  'magic',
  'v',
  'suite',
  'requestId',
  'runId',
  'executorId',
  'identityKeyFp',
  'ephPub',
  'targetKind',
  'exePath',
  'argvHash',
  'kind',
  'displayHash',
  'expiresAt',
] as const;

export const aadFields = (binding: AscAadBinding): string[] => {
  if (!Number.isSafeInteger(binding.expiresAt) || binding.expiresAt <= 0)
    throw new AscError('INVALID_REQUEST', 'expiresAt must be a positive integer (unix ms)');
  if (!binding.requestId || !binding.runId || !binding.executorId || !binding.ephPub || !binding.argvHash)
    throw new AscError('INVALID_REQUEST', 'missing binding field');

  return [
    ASC_AAD_MAGIC,
    String(binding.v),
    binding.suite,
    binding.requestId,
    binding.runId,
    binding.executorId,
    binding.identityKeyFp,
    binding.ephPub,
    binding.targetKind,
    binding.exePath,
    binding.argvHash,
    binding.kind,
    binding.displayHash,
    String(binding.expiresAt),
  ];
};

/** Canonical AAD bytes (spec §6.4). */
export const encodeAad = (binding: AscAadBinding): Uint8Array => encodeFields(aadFields(binding));

export const encodeRequestAad = (request: AscBindableRequest) =>
  encodeAad(aadBindingFromRequest(request));
