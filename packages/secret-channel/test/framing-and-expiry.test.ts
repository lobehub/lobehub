import { describe, expect, it } from 'vitest';

import {
  ASC_MAX_SECRET_BYTES,
  ASC_PAD_BLOCK,
  createRequest,
  EphemeralRecipient,
  framePlaintext,
  generateIdentity,
  hashArgv,
  isAscError,
  sealSecret,
  unframePlaintext,
  utf8Decode,
  utf8Encode,
} from '../src';

const identity = generateIdentity();

const passwordRequest = (ephPub: string) =>
  createRequest({
    ephPub,
    executor: { executorId: 'exec-TEST', executorName: 'Test box' },
    identity,
    kind: 'password',
    label: 'unit',
    purpose: { systemObserved: 'unit' },
    requester: { runId: 'run-1', source: 'tool' },
    target: {
      argvDisplay: 'sink sudo',
      argvHash: hashArgv(['sink', 'sudo']),
      exePath: '/usr/bin/sudo',
      kind: 'sudo',
      verification: 'verified',
    },
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

/** Build a frame with an arbitrary declared length, bypassing `framePlaintext`'s own limits. */
const craftFrame = (declaredLength: number, blocks: number) => {
  const frame = new Uint8Array(blocks * ASC_PAD_BLOCK);
  frame[0] = 0x01;
  frame[1] = (declaredLength >> 8) & 0xff;
  frame[2] = declaredLength & 0xff;
  return frame;
};

describe('plaintext framing bounds', () => {
  it('round-trips a maximum-size secret', () => {
    const secret = new Uint8Array(ASC_MAX_SECRET_BYTES).fill(0x41);
    const framed = framePlaintext(secret);
    expect(framed.length).toBe(4096);
    expect(unframePlaintext(framed)).toEqual(secret);
  });

  it('accepts a frame that declares exactly the maximum secret', () => {
    expect(unframePlaintext(craftFrame(ASC_MAX_SECRET_BYTES, 16)).length).toBe(
      ASC_MAX_SECRET_BYTES,
    );
  });

  it('[ASC-L2-22] rejects a declared length above the protocol maximum', () => {
    // 17 blocks (4352 bytes) is a positive multiple of 256 and has room for the over-long
    // declaration, so only the protocol maximum stops a frame that `framePlaintext` would never
    // have produced from handing back an over-long secret.
    expect(() => unframePlaintext(craftFrame(ASC_MAX_SECRET_BYTES + 1, 17))).toThrowError(
      expect.objectContaining({ code: 'INVALID_ENVELOPE' }),
    );
  });
});

describe('request lifetime boundary', () => {
  it('[ASC-L2-29] the Client refuses to seal at exactly expiresAt', async () => {
    const recipient = await EphemeralRecipient.create();
    const request = passwordRequest(recipient.publicKey);

    expect(
      await codeOf(() =>
        sealSecret({ now: request.expiresAt, request, secret: utf8Encode('hunter2') }),
      ),
    ).toBe('EXPIRED');
  });

  it('still opens one millisecond before expiresAt', async () => {
    const recipient = await EphemeralRecipient.create();
    const request = passwordRequest(recipient.publicKey);
    const envelope = await sealSecret({
      now: request.expiresAt - 1,
      request,
      secret: utf8Encode('hunter2'),
    });

    const opened = await recipient.open(request, envelope, request.expiresAt - 1);
    expect(utf8Decode(opened)).toBe('hunter2');
  });

  it('[ASC-L2-26] the Executor refuses at exactly expiresAt, like the Client', async () => {
    const recipient = await EphemeralRecipient.create();
    const request = passwordRequest(recipient.publicKey);
    const envelope = await sealSecret({
      now: request.expiresAt - 1,
      request,
      secret: utf8Encode('hunter2'),
    });

    expect(await codeOf(() => recipient.open(request, envelope, request.expiresAt))).toBe(
      'EXPIRED',
    );
  });
});
