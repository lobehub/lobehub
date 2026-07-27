import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketService } from '@/server/services/market';

import { credsRuntime } from '../creds';

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn(),
}));

describe('credsRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs workspace context into the Market trusted-client identity', () => {
    credsRuntime.factory({
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(MarketService).toHaveBeenCalledWith({
      userInfo: { userId: 'user-1', workspaceId: 'workspace-1' },
    });
  });

  it('keeps personal runtime identity outside a workspace', () => {
    credsRuntime.factory({
      toolManifestMap: {},
      topicId: 'topic-1',
      userId: 'user-1',
    });

    expect(MarketService).toHaveBeenCalledWith({
      userInfo: { userId: 'user-1', workspaceId: undefined },
    });
  });

  it('rejects runtime creation without a user identity', () => {
    expect(() => credsRuntime.factory({ toolManifestMap: {} })).toThrow(
      'userId is required for Creds execution',
    );
  });
});
