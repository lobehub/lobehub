import { describe, expect, it } from 'vitest';

import {
  type AscRequest,
  createRequest,
  EphemeralRecipient,
  generateIdentity,
  generatePersistableRecipientKey,
  hashArgv,
  isAscError,
  openWithPersistedKey,
  sealSecret,
  utf8Decode,
  utf8Encode,
} from '../src';

const identity = generateIdentity();

/**
 * A verifier-checked Request ([ASC-L2-35]). The persisted opener is Base-only, and Base mode is
 * only sound for a Sink that checks the value against a secret that already exists ([ASC-L2-37]).
 * `createRequest` forces a value-accepting Request onto the Auth suite ([ASC-L2-36]), which this
 * Base-only path cannot open at all — so the fixture has to be a verifier-checked target.
 */
const buildRequest = (ephPub: string, now = Date.now()): AscRequest =>
  createRequest({
    ephPub,
    executor: { executorId: 'lobehub-test', executorName: 'LobeHub' },
    identity,
    kind: 'password',
    label: 'sudo-password',
    now,
    purpose: { systemObserved: 'sudo: lobehub-agent sendMessage' },
    requester: { runId: 'op-1', source: 'tool' },
    target: {
      argvDisplay: 'lobehub-agent sendMessage',
      argvHash: hashArgv(['lobehub-agent', 'sendMessage']),
      exePath: '/usr/bin/sudo',
      kind: 'sudo',
      verification: 'verified',
    },
    ttlSec: 600,
  });

const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (error) {
    if (isAscError(error)) return error.code;
    throw error;
  }
};

describe('persisted recipient', () => {
  it('opens an envelope sealed by the reference client after a round trip through storage', async () => {
    const key = await generatePersistableRecipientKey();
    // What storage holds is plain strings — simulate the round trip.
    const stored = structuredClone(key);
    const request = buildRequest(key.publicKey);

    const envelope = await sealSecret({ request, secret: utf8Encode('482913') });
    const plaintext = await openWithPersistedKey({ envelope, key: stored, request });

    expect(utf8Decode(plaintext)).toBe('482913');
  });

  it('agrees with EphemeralRecipient on what it opens', async () => {
    const recipient = await EphemeralRecipient.create();
    const request = buildRequest(recipient.publicKey);
    const envelope = await sealSecret({ request, secret: utf8Encode('xyz-123') });

    expect(utf8Decode(await recipient.open(request, envelope))).toBe('xyz-123');
  });

  it('refuses an envelope bound to a different request (AAD binding)', async () => {
    const key = await generatePersistableRecipientKey();
    const request = buildRequest(key.publicKey);
    const envelope = await sealSecret({ request, secret: utf8Encode('482913') });

    // Same key, but the action the human saw changed after sealing.
    const tampered = {
      ...request,
      target: { ...request.target, argvHash: hashArgv(['acc-1', 'eve@example.com']) },
    };

    expect(await codeOf(() => openWithPersistedKey({ envelope, key, request: tampered }))).toBe(
      'DECRYPT_FAILED',
    );
  });

  it('refuses a mismatched request id, a foreign key and an expired request before decrypting', async () => {
    const key = await generatePersistableRecipientKey();
    const other = await generatePersistableRecipientKey();
    const now = Date.now();
    const request = buildRequest(key.publicKey, now);
    const envelope = await sealSecret({ request, secret: utf8Encode('482913') });

    expect(
      await codeOf(() =>
        openWithPersistedKey({ envelope: { ...envelope, requestId: 'nope' }, key, request }),
      ),
    ).toBe('REQUEST_MISMATCH');
    expect(await codeOf(() => openWithPersistedKey({ envelope, key: other, request }))).toBe(
      'REQUEST_MISMATCH',
    );
    expect(
      await codeOf(() =>
        openWithPersistedKey({ envelope, key, now: request.expiresAt + 1, request }),
      ),
    ).toBe('EXPIRED');
  });

  it('refuses a sender field on a Base envelope and oversized ciphertext', async () => {
    const key = await generatePersistableRecipientKey();
    const request = buildRequest(key.publicKey);
    const envelope = await sealSecret({ request, secret: utf8Encode('482913') });

    expect(
      await codeOf(() =>
        openWithPersistedKey({ envelope: { ...envelope, sender: 'x' }, key, request }),
      ),
    ).toBe('INVALID_ENVELOPE');
    expect(
      await codeOf(() =>
        openWithPersistedKey({ envelope: { ...envelope, ct: 'A'.repeat(9000) }, key, request }),
      ),
    ).toBe('INVALID_ENVELOPE');
  });
});
