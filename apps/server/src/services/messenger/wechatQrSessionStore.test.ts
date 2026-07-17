// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireWechatQrFinalizeLock,
  consumeWechatQrSession,
  issueWechatQrSession,
  peekWechatQrSession,
  releaseWechatQrFinalizeLock,
} from './wechatQrSessionStore';

const store = new Map<string, string>();

const redis = {
  del: vi.fn(async (...keys: string[]) => {
    let deleted = 0;
    for (const key of keys) deleted += Number(store.delete(key));
    return deleted;
  }),
  eval: vi.fn(async (_script: string, _keyCount: number, key: string, token: string) => {
    if (store.get(key) !== token) return 0;
    store.delete(key);
    return 1;
  }),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: string, ...args: string[]) => {
    if (args.includes('NX') && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  }),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redis,
}));

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('wechatQrSessionStore', () => {
  it('round-trips an opaque, user-bound QR session without exposing the raw QR in its id', async () => {
    const issued = await issueWechatQrSession({
      qrcode: 'raw-secret-qr',
      userId: 'user-1',
    });

    expect(issued.sessionId).not.toContain('raw-secret-qr');
    expect(issued.expiresAt).toBeGreaterThan(Date.now());
    await expect(peekWechatQrSession(issued.sessionId, 'user-1')).resolves.toMatchObject({
      qrcode: 'raw-secret-qr',
      userId: 'user-1',
    });
    await expect(peekWechatQrSession(issued.sessionId, 'user-2')).resolves.toBeNull();
  });

  it('allows only one concurrent finalizer and releases only with the ownership token', async () => {
    const { sessionId } = await issueWechatQrSession({
      qrcode: 'qr',
      userId: 'user-1',
    });
    const first = await acquireWechatQrFinalizeLock(sessionId);

    expect(first).toBeTypeOf('string');
    await expect(acquireWechatQrFinalizeLock(sessionId)).resolves.toBeNull();
    await releaseWechatQrFinalizeLock(sessionId, 'not-the-owner');
    await expect(acquireWechatQrFinalizeLock(sessionId)).resolves.toBeNull();
    await releaseWechatQrFinalizeLock(sessionId, first!);
    await expect(acquireWechatQrFinalizeLock(sessionId)).resolves.toBeTypeOf('string');
  });

  it('consumes both the session and finalization lock after a successful bind', async () => {
    const { sessionId } = await issueWechatQrSession({
      qrcode: 'qr',
      userId: 'user-1',
    });
    await acquireWechatQrFinalizeLock(sessionId);

    await consumeWechatQrSession(sessionId);

    await expect(peekWechatQrSession(sessionId, 'user-1')).resolves.toBeNull();
    await expect(acquireWechatQrFinalizeLock(sessionId)).resolves.toBeTypeOf('string');
  });
});
