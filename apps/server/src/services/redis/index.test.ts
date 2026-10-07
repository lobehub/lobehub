import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redisService } from './index';

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./client', () => ({ getRedisServiceClient: async () => ({ get, set }) }));

describe('Redis domain service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue(null);
    set.mockResolvedValue('OK');
  });

  it('isolates device answers by principal pool and preserves the requested freshness', async () => {
    const fetch = vi.fn().mockResolvedValue({ arch: 'arm64' });
    await redisService.deviceSystemInfo.remember(
      { deviceId: 'd', userId: 'u', workspaceId: 'w' },
      fetch,
      1000,
    );
    expect(set).toHaveBeenCalledWith(
      'device_system_info:v1:u:w:d',
      JSON.stringify({ arch: 'arm64' }),
      { px: 1000 },
    );
    get.mockResolvedValue(JSON.stringify({ arch: 'arm64' }));
    await redisService.deviceSystemInfo.remember(
      { deviceId: 'd', userId: 'u', workspaceId: 'w' },
      fetch,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retain empty skill discoveries and scopes successful reads to the connection', async () => {
    const scope = {
      connection: { createdAt: 'date', providerUserId: 'account' },
      providerId: 'github',
      userId: 'u',
    };
    await redisService.skillTools.remember(scope, async () => ({ tools: [] }));
    expect(set).not.toHaveBeenCalled();
    await redisService.skillTools.remember(scope, async () => ({ tools: ['tool'] }));
    expect(set).toHaveBeenCalledWith(
      'lobehub_skill_tools:v1:u:github:date|account',
      JSON.stringify({ tools: ['tool'] }),
      { px: 600_000 },
    );
  });

  it('grants a rescan only to the winner of the atomic directory claim', async () => {
    const scope = { cwd: '/project', deviceId: 'd', userId: 'u' };
    expect(await redisService.workspaceRescan.claim(scope)).toBe(true);
    set.mockResolvedValue(null);
    expect(await redisService.workspaceRescan.claim(scope)).toBe(false);
    expect(set).toHaveBeenCalledWith('workspace_rescan_claim:v1:u:personal:d:/project', '1', {
      nx: true,
      px: 45_000,
    });
  });
});
