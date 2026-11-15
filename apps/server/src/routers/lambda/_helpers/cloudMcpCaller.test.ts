import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverService } from '@/server/services/discover';

import { resolveRequestCloudMcpCaller } from './cloudMcpCaller';

const resolveMarketUserContext = vi.hoisted(() => vi.fn());
const isTrustedClientEnabled = vi.hoisted(() => vi.fn());
const getUserSettings = vi.hoisted(() => vi.fn());

vi.mock('@/libs/trpc/lambda/middleware', () => ({ resolveMarketUserContext }));
vi.mock('@/libs/trusted-client', () => ({ isTrustedClientEnabled }));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(function UserModel() {
    return { getUserSettings };
  }),
}));
vi.mock('@/server/services/discover', () => ({
  DiscoverService: vi.fn(function DiscoverService(this: any, options: unknown) {
    this.options = options;
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function FileService(this: any, ...args: unknown[]) {
    this.args = args;
  }),
}));

const ctx = {
  marketAccessToken: 'cookie-token',
  serverDB: {} as any,
  userId: 'user-1',
  workspaceId: 'ws-1',
};
const marketUserInfo = { email: 'a@example.com', userId: 'user-1', workspaceId: 'ws-1' };

beforeEach(() => {
  vi.clearAllMocks();
  resolveMarketUserContext.mockResolvedValue({ marketAccessToken: 'db-token', marketUserInfo });
});

describe('resolveRequestCloudMcpCaller', () => {
  it('forwards the stored Market token when trusted-client auth is not configured', async () => {
    isTrustedClientEnabled.mockReturnValue(false);
    getUserSettings.mockResolvedValue({ market: { accessToken: 'db-token' } });

    const caller = await resolveRequestCloudMcpCaller(ctx);

    expect(caller?.userAccessToken).toBe('db-token');
    expect(DiscoverService).toHaveBeenCalledWith({
      accessToken: 'db-token',
      userInfo: marketUserInfo,
    });
    // Media blocks are stored in the requester's own (workspace) storage
    expect((caller?.fileService as any).args).toEqual([ctx.serverDB, 'user-1', 'ws-1']);
  });

  it('has no caller without a stored Market token when trusted-client auth is off', async () => {
    isTrustedClientEnabled.mockReturnValue(false);
    getUserSettings.mockResolvedValue({ market: {} });

    await expect(resolveRequestCloudMcpCaller(ctx)).resolves.toBeUndefined();
    expect(DiscoverService).not.toHaveBeenCalled();
  });

  it('runs as the trusted-client identity without reading a user token', async () => {
    isTrustedClientEnabled.mockReturnValue(true);

    const caller = await resolveRequestCloudMcpCaller(ctx);

    expect(caller?.userAccessToken).toBeUndefined();
    expect(getUserSettings).not.toHaveBeenCalled();
    expect(DiscoverService).toHaveBeenCalledWith({
      accessToken: 'db-token',
      userInfo: marketUserInfo,
    });
  });
});
