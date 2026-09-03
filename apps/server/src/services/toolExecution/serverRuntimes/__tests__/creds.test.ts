import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketService } from '@/server/services/market';

import { type ToolExecutionContext } from '../../types';
import { credsRuntime, ServerCredsService } from '../creds';

const { getMember } = vi.hoisted(() => ({
  getMember: vi.fn(),
}));

vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn().mockImplementation(() => ({ getMember })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(),
}));

describe('credsRuntime', () => {
  const serverDB = {} as NonNullable<ToolExecutionContext['serverDB']>;

  beforeEach(() => {
    vi.clearAllMocks();
    getMember.mockResolvedValue({ role: 'member' });
  });

  it('signs verified workspace context into the Market trusted-client identity', async () => {
    await credsRuntime.factory({
      serverDB,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(getMember).toHaveBeenCalledWith('workspace-1', 'user-1');
    expect(MarketService).toHaveBeenCalledWith({
      userInfo: { userId: 'user-1', workspaceId: 'workspace-1' },
    });
  });

  it('rejects workspace context without an active membership', async () => {
    getMember.mockResolvedValue(undefined);

    await expect(
      credsRuntime.factory({
        serverDB,
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('Workspace membership is required for workspace Creds execution');
    expect(MarketService).not.toHaveBeenCalled();
  });

  it('fails closed when workspace membership cannot be queried', async () => {
    await expect(
      credsRuntime.factory({
        toolManifestMap: {},
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('serverDB is required for workspace Creds execution');
    expect(getMember).not.toHaveBeenCalled();
    expect(MarketService).not.toHaveBeenCalled();
  });

  it('keeps personal runtime identity outside a workspace', async () => {
    await credsRuntime.factory({
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(getMember).not.toHaveBeenCalled();
    expect(MarketService).toHaveBeenCalledWith({
      userInfo: { userId: 'user-1', workspaceId: undefined },
    });
  });

  it('rejects runtime creation without a user identity', async () => {
    await expect(credsRuntime.factory({ toolManifestMap: {} })).rejects.toThrow(
      'userId is required for Creds execution',
    );
  });

  // `lobe-creds` is already absent from `AGENT_SHARE_ALLOWED_BUILTIN_IDENTIFIERS`,
  // so this runtime should never even be constructed for a share visitor —
  // this is the belt-and-braces backstop in case that allowlist gate is ever
  // bypassed: the sandbox write path must refuse on its own too, since
  // `~/.creds/env` must never receive the creator's decrypted credentials
  // inside a sandbox a visitor's model can run arbitrary shell commands in.
  it('refuses to write credentials into the sandbox for a share-visitor run', async () => {
    vi.mocked(MarketService).mockImplementation(
      () =>
        ({
          market: {
            creds: {
              inject: vi.fn().mockResolvedValue({
                credentials: { env: { FOO: 'bar' } },
              }),
            },
          },
        }) as any,
    );

    const runtime = await credsRuntime.factory({
      agentShareVisitor: { agentId: 'agent-1' } as any,
      serverDB,
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    const result = await (runtime as any).injectCredsToSandbox({ keys: ['FOO'] });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('unavailable in shared conversations');
  });
});

describe('ServerCredsService.injectCreds', () => {
  const buildMarketService = (inject = vi.fn()) =>
    ({ market: { creds: { inject } } }) as unknown as MarketService;

  // Regression test: an earlier version of this method took the
  // `credentials.env` map back from market's `/inject-creds` response and
  // wrote it into the sandbox a second time. But that response is already
  // masked for safe display (market itself writes the *real* values into
  // ~/.creds/env server-side when `sandbox` is true) — so the second write
  // appended a masked `export` line after market's real one, and since
  // re-sourcing the file applies `export`s in file order, the masked line
  // silently shadowed the real credential for every later command. The fix
  // is to only forward market's response, never re-write it — this test
  // locks that in by asserting `market.creds.inject` is the only call made
  // and its result is returned untouched.
  it("forwards market.creds.inject's result without writing it into the sandbox again", async () => {
    const injectResult = {
      credentials: { env: { DC_CLI_TOKEN: '8f******vZ' } },
      notFound: [],
      success: true,
    };
    const inject = vi.fn().mockResolvedValue(injectResult);
    const service = new ServerCredsService(buildMarketService(inject), 'workspace-1');

    const result = await service.injectCreds({
      keys: ['dc-cli-token'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject).toHaveBeenCalledWith({
      keys: ['dc-cli-token'],
      sandbox: true,
      topicId: 'topic-1',
      userId: 'user-1',
    });
    expect(result).toBe(injectResult);
  });
});
