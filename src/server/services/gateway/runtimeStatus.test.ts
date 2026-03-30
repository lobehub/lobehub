// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = {
  del: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => mockRedis),
}));

const { BOT_RUNTIME_STATUSES, getBotRuntimeStatus, updateBotRuntimeStatus } =
  await import('./runtimeStatus');

describe('runtimeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disconnected when no cached runtime status exists', async () => {
    mockRedis.get.mockResolvedValue(null);

    await expect(getBotRuntimeStatus('wechat', 'app-1')).resolves.toEqual({
      applicationId: 'app-1',
      platform: 'wechat',
      status: BOT_RUNTIME_STATUSES.disconnected,
      updatedAt: 0,
    });
  });

  it('persists runtime status with ttl when requested', async () => {
    mockRedis.set.mockResolvedValue('OK');

    await updateBotRuntimeStatus(
      {
        applicationId: 'app-1',
        platform: 'wechat',
        status: BOT_RUNTIME_STATUSES.connected,
      },
      { now: 123, ttlMs: 2500 },
    );

    expect(mockRedis.set).toHaveBeenCalledWith(
      'bot:runtime-status:wechat:app-1',
      JSON.stringify({
        applicationId: 'app-1',
        platform: 'wechat',
        status: BOT_RUNTIME_STATUSES.connected,
        updatedAt: 123,
      }),
      'EX',
      3,
    );
  });

  it('cleans malformed runtime status payloads', async () => {
    mockRedis.get.mockResolvedValue('{bad-json');
    mockRedis.del.mockResolvedValue(1);

    const result = await getBotRuntimeStatus('slack', 'app-2');

    expect(mockRedis.del).toHaveBeenCalledWith('bot:runtime-status:slack:app-2');
    expect(result.status).toBe(BOT_RUNTIME_STATUSES.disconnected);
  });
});
