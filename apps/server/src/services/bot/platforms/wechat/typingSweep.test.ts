// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wechatWindowKey } from './contextWindow';
import { resetWechatTypingCredentialCache, runWechatTypingSweep } from './typingSweep';

// Heavyweight default-credential path is not exercised — tests inject resolveCredentials.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: { findEnabledByPlatformAndAppId: vi.fn(async () => null) },
}));
vi.mock('@/server/services/messenger/installations', () => ({
  getInstallationStore: vi.fn(() => null),
}));

const TYPING_KEY = 'wechat:typing:app-1:wx-user-1';

/** Fake redis covering the registry commands plus peekWindow's hash reads. */
const makeRedis = (opts: { strings?: Record<string, string>; window?: boolean } = {}) => {
  const strings: Record<string, string> = { ...opts.strings };
  const hashes: Record<string, Record<string, string>> = opts.window === false
    ? {}
    : { [wechatWindowKey('app-1', 'wx-user-1')]: { token: 'ctx-9' } };
  return {
    del: vi.fn(async () => 0),
    expire: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => strings[key] ?? null),
    hgetall: vi.fn(async (key: string) => hashes[key] ?? null),
    hincrby: vi.fn(async () => 0),
    hset: vi.fn(async () => 1),
    pexpire: vi.fn(async () => 1),
    scan: vi.fn(async () => ['0', Object.keys(strings)] as [string, string[]]),
    set: vi.fn(async () => 'OK'),
    ttl: vi.fn(async () => 3600),
  } as never;
};

const activeEntry = JSON.stringify({ applicationId: 'app-1', wechatUserId: 'wx-user-1' });
const credentials = async () => ({ botToken: 'token-1' });

describe('runWechatTypingSweep', () => {
  beforeEach(() => {
    resetWechatTypingCredentialCache();
  });

  it('pulses every owned registry entry', async () => {
    const startTyping = vi.fn(async () => {});
    await runWechatTypingSweep(makeRedis({ strings: { [TYPING_KEY]: activeEntry } }), () => true, {
      createApiClient: () => ({ startTyping }),
      resolveCredentials: credentials,
    });
    expect(startTyping).toHaveBeenCalledWith('wx-user-1', 'ctx-9');
  });

  it('skips entries owned by another shard', async () => {
    const startTyping = vi.fn(async () => {});
    await runWechatTypingSweep(makeRedis({ strings: { [TYPING_KEY]: activeEntry } }), () => false, {
      createApiClient: () => ({ startTyping }),
      resolveCredentials: credentials,
    });
    expect(startTyping).not.toHaveBeenCalled();
  });

  it('skips an entry without a send-window token and never throws', async () => {
    const startTyping = vi.fn(async () => {});
    await expect(
      runWechatTypingSweep(
        makeRedis({ strings: { [TYPING_KEY]: activeEntry }, window: false }),
        () => true,
        { createApiClient: () => ({ startTyping }), resolveCredentials: credentials },
      ),
    ).resolves.toBeUndefined();
    expect(startTyping).not.toHaveBeenCalled();
  });

  it('skips an entry whose credentials cannot be resolved', async () => {
    const startTyping = vi.fn(async () => {});
    await runWechatTypingSweep(makeRedis({ strings: { [TYPING_KEY]: activeEntry } }), () => true, {
      createApiClient: () => ({ startTyping }),
      resolveCredentials: async () => null,
    });
    expect(startTyping).not.toHaveBeenCalled();
  });

  it('caches credential resolution across passes', async () => {
    const startTyping = vi.fn(async () => {});
    const resolveCredentials = vi.fn(credentials);
    const redis = makeRedis({ strings: { [TYPING_KEY]: activeEntry } });
    const deps = { createApiClient: () => ({ startTyping }), resolveCredentials };

    await runWechatTypingSweep(redis, () => true, deps);
    await runWechatTypingSweep(redis, () => true, deps);

    expect(startTyping).toHaveBeenCalledTimes(2);
    expect(resolveCredentials).toHaveBeenCalledTimes(1);
  });
});
