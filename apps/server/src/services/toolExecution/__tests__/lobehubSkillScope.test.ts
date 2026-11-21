/**
 * Regression (T-14043): inside a workspace, every Notion tool answered
 * NOT_CONNECTED while the `lobe-creds` status check said Notion was connected.
 *
 * A LobeHub Skill connection lives either on the personal Market account or on
 * the workspace's mirrored Market organization (the trust token's `workspaceId`
 * claim selects which). Settings and `lobe-creds` inside a workspace read the
 * workspace one; the agent-run skill call read only the personal one.
 *
 * Real code under test: BuiltinToolsExecutor → MarketService → trusted-client
 * token minting, and ServerCredsService. Only the network edge (`MarketSDK`) is
 * faked: it decrypts the token like Market does and answers from the
 * connections of the scope the token names.
 */
import { createDecipheriv, createHash } from 'node:crypto';

import type * as MarketSDKModule from '@lobehub/market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltinToolsExecutor } from '../builtin';
import { ServerCredsService } from '../serverRuntimes/creds';
import type { ToolExecutionContext } from '../types';

const SECRET = 'lobehub-market_tcs_repro-secret';

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

const members = vi.hoisted(() => new Set<string>());
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn().mockImplementation(function () {
    return {
      getMember: vi.fn(async (workspaceId: string, userId: string) =>
        members.has(`${workspaceId}:${userId}`) ? { role: 'member', userId, workspaceId } : null,
      ),
    };
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
const decryptTrustToken = (token: string) => {
  const raw = Buffer.from(token, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const key = createHash('sha256').update(SECRET).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
  ) as { userId: string; workspaceId?: string };
};

const market = vi.hoisted(() => ({
  /** Scope keys (`personal:<userId>` / `workspace:<id>`) → connected providers. */
  connections: new Map<string, Set<string>>(),
  /** Every skill call Market received, by the scope its token named. */
  calls: [] as { provider: string; scope: string; tool: string }[],
  /** How Market words NOT_CONNECTED: a structured error, or a message + `code`. */
  notConnectedBody: 'object' as 'object' | 'string',
}));

vi.mock('@lobehub/market-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof MarketSDKModule>();

  class FakeMarketSDK {
    connect: { getStatus: (provider: string) => Promise<{ connected: boolean }> };
    skills: {
      callTool: (provider: string, params: { args: unknown; tool: string }) => Promise<unknown>;
    };

    constructor(opts: { trustedClientToken?: string }) {
      const payload = decryptTrustToken(opts.trustedClientToken!);
      const scope = payload.workspaceId
        ? `workspace:${payload.workspaceId}`
        : `personal:${payload.userId}`;
      const isConnected = (provider: string) =>
        market.connections.get(scope)?.has(provider) ?? false;

      this.connect = { getStatus: async (provider) => ({ connected: isConnected(provider) }) };
      this.skills = {
        callTool: async (provider, { tool }) => {
          market.calls.push({ provider, scope, tool });
          if (!isConnected(provider)) {
            throw new actual.MarketAPIError(
              400,
              'Bad Request',
              market.notConnectedBody === 'object'
                ? { error: { code: 'NOT_CONNECTED', message: `${provider} is not connected` } }
                : { code: 'NOT_CONNECTED', error: `${provider} is not connected` },
            );
          }
          return { data: { ok: true, ranAs: scope, tool }, success: true };
        },
      };
    }
  }

  return { ...actual, MarketSDK: FakeMarketSDK };
});

const USER = 'user_kermit';
const WORKSPACE = 'ws_team';

const notionWrite = {
  apiName: 'API-post-page',
  arguments: '{"parent":{"database_id":"db_1"},"properties":{}}',
  id: 'call-1',
  identifier: 'notion',
  source: 'lobehubSkill',
  type: 'default',
} as any;

const workspaceRun = {
  topicId: 'tpc_repro',
  userId: USER,
  workspaceId: WORKSPACE,
} as ToolExecutionContext;
const personalRun = { topicId: 'tpc_repro', userId: USER } as ToolExecutionContext;

const connect = (scope: string, provider: string) =>
  market.connections.set(scope, new Set([...(market.connections.get(scope) ?? []), provider]));

const report = (label: string, result: unknown) =>
  console.log(
    `[T-14043 repro] ${label}\n  calls: ${JSON.stringify(market.calls)}\n  result: ${JSON.stringify(result)}`,
  );

describe('LobeHub Skill connection scope at tool execution (T-14043)', () => {
  beforeEach(() => {
    market.connections.clear();
    market.calls.length = 0;
    market.notConnectedBody = 'object';
    members.clear();
    members.add(`${WORKSPACE}:${USER}`);
  });

  it('workspace-scoped connection: the call runs instead of answering NOT_CONNECTED', async () => {
    connect(`workspace:${WORKSPACE}`, 'notion');

    // The credential tool reads the workspace scope and says "connected" …
    const creds = new ServerCredsService(
      new (await import('@/server/services/market')).MarketService({
        userInfo: { userId: USER, workspaceId: WORKSPACE },
      }),
      { workspaceId: WORKSPACE },
    );
    expect(await creds.getOAuthConnectionStatus('notion')).toEqual({ connected: true });

    // … and the tool call now reaches the same connection
    const result = await new BuiltinToolsExecutor({} as any, USER).execute(
      notionWrite,
      workspaceRun,
    );
    report('workspace-scoped Notion, workspace run', result);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({ ranAs: `workspace:${WORKSPACE}` });
    expect(market.calls.map((call) => call.scope)).toEqual([
      `personal:${USER}`,
      `workspace:${WORKSPACE}`,
    ]);
  });

  it('user-scoped connection: the personal connection is used first, the workspace is not asked', async () => {
    connect(`personal:${USER}`, 'notion');

    const result = await new BuiltinToolsExecutor({} as any, USER).execute(
      notionWrite,
      workspaceRun,
    );
    report('user-scoped Notion, workspace run', result);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({ ranAs: `personal:${USER}` });
    expect(market.calls.map((call) => call.scope)).toEqual([`personal:${USER}`]);
  });

  it('user-scoped connection in a personal run keeps working', async () => {
    connect(`personal:${USER}`, 'notion');

    const result = await new BuiltinToolsExecutor({} as any, USER).execute(
      notionWrite,
      personalRun,
    );

    expect(result.success).toBe(true);
    expect(market.calls.map((call) => call.scope)).toEqual([`personal:${USER}`]);
  });

  it('still detects NOT_CONNECTED when Market words it as a message plus a code', async () => {
    market.notConnectedBody = 'string';
    connect(`workspace:${WORKSPACE}`, 'notion');

    const result = await new BuiltinToolsExecutor({} as any, USER).execute(
      notionWrite,
      workspaceRun,
    );

    expect(result.success).toBe(true);
    expect(market.calls.map((call) => call.scope)).toEqual([
      `personal:${USER}`,
      `workspace:${WORKSPACE}`,
    ]);
  });

  it('connected nowhere: NOT_CONNECTED names every scope it checked', async () => {
    const result = await new BuiltinToolsExecutor({} as any, USER).execute(
      notionWrite,
      workspaceRun,
    );
    report('Notion connected nowhere, workspace run', result);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      checkedScopes: ['personal', `workspace:${WORKSPACE}`],
      code: 'NOT_CONNECTED',
    });
    expect(result.content).toContain('not connected for your personal account or this workspace');
  });

  it('never acts as a workspace the caller is no longer a member of', async () => {
    members.clear();
    connect(`workspace:${WORKSPACE}`, 'notion');

    const result = await new BuiltinToolsExecutor({} as any, USER).execute(
      notionWrite,
      workspaceRun,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ checkedScopes: ['personal'], code: 'NOT_CONNECTED' });
    expect(market.calls.map((call) => call.scope)).toEqual([`personal:${USER}`]);
  });

  it('a share visitor run never falls back to the workspace scope', async () => {
    connect(`workspace:${WORKSPACE}`, 'notion');

    const result = await new BuiltinToolsExecutor({} as any, USER).execute(notionWrite, {
      ...workspaceRun,
      agentShareVisitor: { shareId: 'shr_1' },
    } as any);

    expect(result.success).toBe(false);
    expect(market.calls.map((call) => call.scope)).toEqual([`personal:${USER}`]);
  });

  it('the credential tool says connected for a user-scoped connection inside a workspace too', async () => {
    connect(`personal:${USER}`, 'notion');
    const { MarketService } = await import('@/server/services/market');

    const creds = new ServerCredsService(
      new MarketService({ userInfo: { userId: USER, workspaceId: WORKSPACE } }),
      {
        personalMarketService: new MarketService({ userInfo: { userId: USER } }),
        workspaceId: WORKSPACE,
      },
    );

    expect(await creds.getOAuthConnectionStatus('notion')).toEqual({ connected: true });
    expect(await creds.getOAuthConnectionStatus('linear')).toEqual({ connected: false });
  });
});
