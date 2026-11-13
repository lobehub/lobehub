import { describe, expect, it } from 'vitest';

import {
  ASC_SUITE,
  ASC_SUITE_AUTH,
  ASC_VERSION,
  createRequest,
  EphemeralRecipient,
  generateIdentity,
  generatePersistableRecipientKey,
  hashArgv,
  isAscError,
  openWithPersistedKey,
  verifyRequest,
} from '../src';

const identity = generateIdentity();
const UNKNOWN_SUITE = 'DHKEM-X25519-HKDF-SHA256/HKDF-SHA256/AES-128-GCM';

const target = (kind: string) => ({
  argvDisplay: `sink ${kind}`,
  argvHash: hashArgv(['sink', kind]),
  exePath: `/usr/bin/${kind}`,
  kind,
  verification: 'verified' as const,
});

const build = (
  over: {
    ephPub?: string;
    kind?: string;
    setsNewSecret?: boolean;
    suite?: string;
    targetKind?: string;
  } = {},
) =>
  createRequest({
    ephPub: over.ephPub ?? 'A'.repeat(43),
    executor: { executorId: 'exec-TEST', executorName: 'Test box' },
    identity,
    kind: over.kind ?? 'token',
    label: 'unit',
    purpose: { systemObserved: 'unit' },
    requester: { runId: 'run-1', source: 'tool' },
    setsNewSecret: over.setsNewSecret,
    suite: over.suite as never,
    target: target(over.targetKind ?? 'git'),
  });

const codeOf = async (fn: () => unknown) => {
  try {
    await fn();
    return null;
  } catch (error) {
    if (isAscError(error)) return error.code;
    throw error;
  }
};

describe('fail closed', () => {
  it('[ASC-L2-36] gives a value-accepting Request the Auth suite even when none is asked for', () => {
    expect(build({ kind: 'token' }).suite).toBe(ASC_SUITE_AUTH);
    expect(build({ kind: 'approval', targetKind: 'git' }).suite).toBe(ASC_SUITE_AUTH);
    // A Sink that writes a new secret is value-accepting even for a verifier-checked kind and
    // target ([ASC-L2-35], [ASC-EXT-07]) — the ssh-keygen case.
    expect(build({ kind: 'passphrase', setsNewSecret: true, targetKind: 'ssh' }).suite).toBe(
      ASC_SUITE_AUTH,
    );
  });

  it('[ASC-L2-37] keeps Base for a verifier-checked Request without a Client, and honours Auth', () => {
    expect(build({ kind: 'password', targetKind: 'sudo' }).suite).toBeUndefined();
    expect(build({ kind: 'password', targetKind: 'sudo', suite: ASC_SUITE_AUTH }).suite).toBe(
      ASC_SUITE_AUTH,
    );
  });

  it('[ASC-EXT-02] rejects a Request whose v this implementation does not speak', () => {
    const request = build({ kind: 'password', targetKind: 'sudo' });
    expect(() => verifyRequest(request)).not.toThrow();
    expect(() => verifyRequest({ ...request, v: 2 as never })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }),
    );
  });

  it('[ASC-L2-28] maps a malformed identity key to FINGERPRINT_MISMATCH, not a decode error', () => {
    const request = build({ kind: 'password', targetKind: 'sudo' });

    // Relay-supplied metadata: a key that is not valid base64url must fail as an ASC error, since
    // callers classify failures through `AscError`.
    for (const identityPublicKey of ['!', 'abc!', 'AAAAA', ''])
      expect(() =>
        verifyRequest({ ...request, executor: { ...request.executor, identityPublicKey } }),
      ).toThrowError(expect.objectContaining({ code: 'FINGERPRINT_MISMATCH' }));
  });

  it('[ASC-EXT-02] the Executor opener rejects a Request whose v it does not speak', async () => {
    const recipient = await EphemeralRecipient.create();
    const request = build({ ephPub: recipient.publicKey, kind: 'password', targetKind: 'sudo' });
    const envelope = {
      ct: 'AA',
      enc: 'AA',
      requestId: request.id,
      suite: ASC_SUITE,
      v: ASC_VERSION,
    };

    expect(
      await codeOf(() => recipient.open({ ...request, v: 2 as never }, envelope, Date.now())),
    ).toBe('UNSUPPORTED_VERSION');
    // Refused before consumption: a v1 Request still gets as far as decryption, not REPLAYED.
    expect(await codeOf(() => recipient.open(request, envelope, Date.now()))).not.toBe('REPLAYED');
  });

  it('[ASC-EXT-02] the persisted opener rejects a Request whose v it does not speak', async () => {
    const key = await generatePersistableRecipientKey();
    const request = build({ ephPub: key.publicKey, kind: 'password', targetKind: 'sudo' });
    const envelope = {
      ct: 'AA',
      enc: 'AA',
      requestId: request.id,
      suite: ASC_SUITE,
      v: ASC_VERSION,
    };

    expect(
      await codeOf(() =>
        openWithPersistedKey({ envelope, key, request: { ...request, v: 2 as never } }),
      ),
    ).toBe('UNSUPPORTED_VERSION');
  });

  it('[ASC-L2-28] maps a malformed persisted private key to DECRYPT_FAILED, not a decode error', async () => {
    const key = await generatePersistableRecipientKey();
    const request = build({ ephPub: key.publicKey, kind: 'password', targetKind: 'sudo' });
    const envelope = {
      ct: 'AA',
      enc: 'AA',
      requestId: request.id,
      suite: ASC_SUITE,
      v: ASC_VERSION,
    };

    // A corrupted or tampered at-rest record must fail as an ASC error, since callers classify
    // failures through `AscError`.
    expect(
      await codeOf(() =>
        openWithPersistedKey({ envelope, key: { ...key, privateKey: '!' }, request }),
      ),
    ).toBe('DECRYPT_FAILED');
  });

  it('[ASC-L2-02] refuses an unrecognised Request suite label instead of opening it in Base mode', async () => {
    const recipient = await EphemeralRecipient.create();
    const request = build({ ephPub: recipient.publicKey, kind: 'password', targetKind: 'sudo' });
    expect(request.suite).toBeUndefined();

    const unknown = { ...request, suite: UNKNOWN_SUITE as never };
    const envelope = {
      ct: 'AA',
      enc: 'AA',
      requestId: unknown.id,
      suite: UNKNOWN_SUITE as never,
      v: ASC_VERSION,
    };

    // The label is refused before any key consumption, like REQUEST_MISMATCH ([ASC-L2-38]).
    expect(await codeOf(() => recipient.open(unknown, envelope, Date.now()))).toBe(
      'UNSUPPORTED_VERSION',
    );

    // Not consumed: the recipient is still pending, so a Base-suite Envelope gets as far as
    // decryption rather than being refused as REPLAYED.
    expect(
      await codeOf(() =>
        recipient.open(request, { ...envelope, suite: ASC_SUITE as never }, Date.now()),
      ),
    ).not.toBe('REPLAYED');
  });

  it('[ASC-L2-02] the persisted Base-only opener refuses an unrecognised Request suite label', async () => {
    const key = await generatePersistableRecipientKey();
    const request = build({ ephPub: key.publicKey, kind: 'password', targetKind: 'sudo' });
    expect(request.suite).toBeUndefined();

    const unknown = { ...request, suite: UNKNOWN_SUITE as never };
    const envelope = {
      ct: 'AA',
      enc: 'AA',
      requestId: unknown.id,
      suite: UNKNOWN_SUITE as never,
      v: ASC_VERSION,
    };

    expect(await codeOf(() => openWithPersistedKey({ envelope, key, request: unknown }))).toBe(
      'UNSUPPORTED_VERSION',
    );
  });

  it('[ASC-L2-02] the persisted opener still refuses the Auth suite up front', async () => {
    const key = await generatePersistableRecipientKey();
    const request = build({ ephPub: key.publicKey, kind: 'token' });
    expect(request.suite).toBe(ASC_SUITE_AUTH);

    const envelope = {
      ct: 'AA',
      enc: 'AA',
      requestId: request.id,
      suite: ASC_SUITE_AUTH,
      v: ASC_VERSION,
    };
    expect(await codeOf(() => openWithPersistedKey({ envelope, key, request }))).toBe(
      'SENDER_AUTH_REQUIRED',
    );
  });
});
