import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketService } from '@/server/services/market';

import { type ToolExecutionContext } from '../../types';
import { credsRuntime } from '../creds';

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
});
