import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  findOwnLiveRuns: vi.fn(),
  isRunAlive: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: { steerQueue: { append: mocks.append, entryState: vi.fn(), remove: vi.fn() } },
}));
vi.mock('./liveRuns', () => ({
  findOwnLiveRuns: mocks.findOwnLiveRuns,
  isRunAlive: mocks.isRunAlive,
}));
vi.mock('@/server/services/aiAgent/agentSenderResolver', () => ({ resolveAgentSender: vi.fn() }));

const { queueFollowUp } = await import('./followUps');

const ctx = { db: {} as any, userId: 'user-1' };
const scope = { threadId: null, topicId: 'tpc-1', userId: 'user-1' };
const request = { agentId: 'agt-1', prompt: 'more' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findOwnLiveRuns.mockResolvedValue(['op-newer', 'op-older']);
  mocks.append.mockResolvedValue(1);
  mocks.isRunAlive.mockResolvedValue(true);
});

describe('queueFollowUp behindOperationId', () => {
  it('queues behind the newest live run when no run is named', async () => {
    const result = await queueFollowUp(ctx, { request, scope });
    expect(result).toMatchObject({ length: 1, queued: true, state: 'queued' });
    expect(mocks.append).toHaveBeenCalledWith(scope, expect.anything(), 'op-newer');
  });

  it('stores nothing when the named run is not the one taking messages', async () => {
    const result = await queueFollowUp(ctx, { behindOperationId: 'op-older', request, scope });
    expect(result).toEqual({ queued: false, reason: 'idle' });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it('queues behind the named run when it is the newest live one', async () => {
    await queueFollowUp(ctx, { behindOperationId: 'op-newer', request, scope });
    expect(mocks.append).toHaveBeenCalledWith(scope, expect.anything(), 'op-newer');
  });
});
