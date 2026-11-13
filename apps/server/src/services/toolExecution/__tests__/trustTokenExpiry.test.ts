/**
 * Regression: a LobeHub Skill (github / notion / twitter …) started failing with
 * `"invalid_trust_token"` once the executor had been alive for > 5 minutes —
 * the inline step loop keeps one executor alive for a whole `/api/agent/run`
 * invocation (up to 450s), but the trusted-client token was minted only once.
 *
 * Real code under test: BuiltinToolsExecutor → MarketService → trusted-client
 * token minting (real `buildTrustedClientPayload` / `createTrustedClientToken`).
 * Only the network edge (`MarketSDK`) is faked, and the fake applies Market's own
 * server-side rule: decrypt the token and reject it when
 * `now - payload.timestamp > 5 min` with
 * `401 { error: 'invalid_trust_token', error_description: 'Token expired' }`.
 */
import { createDecipheriv, createHash } from 'node:crypto';

import type * as MarketSDKModule from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltinToolsExecutor } from '../builtin';
import type { ToolExecutionContext } from '../types';

const SECRET = 'lobehub-market_tcs_repro-secret';
const EXPIRY_MS = 5 * 60 * 1000;

vi.mock('@/envs/app', () => ({
  appEnv: {
    MARKET_TRUSTED_CLIENT_ID: 'lobehub-cloud',
    MARKET_TRUSTED_CLIENT_SECRET: 'lobehub-market_tcs_repro-secret',
  },
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: vi.fn(async () => ({})) };
  }),
}));

vi.mock('../serverRuntimes', () => ({
  getServerRuntime: vi.fn(),
  hasServerRuntime: vi.fn().mockReturnValue(false),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn(),
}));

/** Market's validator, mirrored: aes-256-gcm(iv|ciphertext|tag), sha256(secret) key. */
const marketValidate = (token: string) => {
  const raw = Buffer.from(token, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const key = createHash('sha256').update(SECRET).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const payload = JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
  );
  return { expired: Date.now() - payload.timestamp > EXPIRY_MS, payload };
};

const market = vi.hoisted(() => ({
  calls: [] as { expired: boolean; token: string }[],
  minted: [] as number[],
  /** Tokens Market rejects regardless of age (e.g. clock skew between hosts). */
  rejectAll: false,
  rejectOnce: new Set<string>(),
}));

vi.mock('@lobehub/market-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof MarketSDKModule>();

  class FakeMarketSDK {
    skills: { callTool: () => Promise<unknown> };

    constructor(opts: { trustedClientToken?: string }) {
      const token = opts.trustedClientToken!;
      market.minted.push(marketValidate(token).payload.timestamp);
      this.skills = {
        callTool: async () => {
          const { expired } = marketValidate(token);
          market.calls.push({ expired, token });
          const rejectedOnce = market.rejectOnce.delete(token);
          if (market.rejectAll || rejectedOnce || expired) {
            throw new actual.MarketAPIError(401, 'Unauthorized', {
              error: 'invalid_trust_token',
              error_description: 'Token expired',
            });
          }
          return { data: { exitCode: 0, output: 'ok' }, success: true };
        },
      };
    }
  }

  return { ...actual, MarketSDK: FakeMarketSDK };
});

const githubRunCommand = {
  apiName: 'runCommand',
  arguments: '{"command":"gh auth status"}',
  id: 'call-1',
  identifier: 'github',
  source: 'lobehubSkill',
  type: 'default',
} as any;

const context = { topicId: 'tpc_repro', userId: 'user_repro' } as ToolExecutionContext;

describe('LobeHub Skill trust token lifetime vs executor lifetime', () => {
  beforeEach(() => {
    market.calls.length = 0;
    market.minted.length = 0;
    market.rejectAll = false;
    market.rejectOnce.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-21T14:50:58Z'));
  });

  it('keeps working past 5 minutes inside one executor (one /api/agent/run inline loop)', async () => {
    // One BuiltinToolsExecutor lives for the whole runStep invocation, which the
    // inline step loop keeps alive for up to INLINE_STEP_START_DEADLINE_MS (450s).
    const executor = new BuiltinToolsExecutor({} as any, 'user_repro');

    const first = await executor.execute(githubRunCommand, context);
    expect(first.success).toBe(true);

    vi.advanceTimersByTime(299_000);
    const at299s = await executor.execute(githubRunCommand, context);
    expect(at299s.success).toBe(true);

    vi.advanceTimersByTime(2_000); // 301s after the first token was minted
    const at301s = await executor.execute(githubRunCommand, context);

    expect(at301s).toMatchObject({ success: true });
    // Market never saw an expired token: it was re-minted before the deadline
    expect(market.calls.map(({ expired }) => expired)).toEqual([false, false, false]);
  });

  it('re-mints the token and retries once when Market rejects it as invalid_trust_token', async () => {
    const executor = new BuiltinToolsExecutor({} as any, 'user_repro');
    await executor.execute(githubRunCommand, context);
    market.rejectOnce.add(market.calls[0].token);

    const result = await executor.execute(githubRunCommand, context);

    expect(result.success).toBe(true);
    expect(market.calls).toHaveLength(3);
    expect(market.calls[2].token).not.toBe(market.calls[1].token);
  });

  it('tells the model why the token was rejected when the retry is rejected too', async () => {
    market.rejectAll = true;
    const executor = new BuiltinToolsExecutor({} as any, 'user_repro');

    const result = await executor.execute(githubRunCommand, context);

    expect(result.success).toBe(false);
    expect(market.calls).toHaveLength(2);
    expect(result.content).toContain('invalid_trust_token');
    expect(result.content).toContain('Token expired');
    expect(result.error).toMatchObject({ code: 'invalid_trust_token' });
  });
});
