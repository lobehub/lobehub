// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { subscribeToOnboardingGenerationProgress } from './index';

const redis = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  handler: undefined as ((channel: string, message: string) => void) | undefined,
  quit: vi.fn(async () => undefined),
  removeListener: vi.fn(),
  subscribe: vi.fn(async () => undefined),
  unsubscribe: vi.fn(async () => undefined),
}));

vi.mock('ioredis', () => ({
  default: class {
    connect = redis.connect;
    on = (_event: string, handler: (channel: string, message: string) => void) => {
      redis.handler = handler;
    };
    quit = redis.quit;
    removeListener = redis.removeListener;
    subscribe = redis.subscribe;
    unsubscribe = redis.unsubscribe;
  },
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/envs/redis', () => ({
  getRedisConfig: () => ({ enabled: true, prefix: 'test', url: 'redis://localhost:6379' }),
}));
vi.mock('@/server/modules/Redis', () => ({ isRedisEnabled: () => true }));
vi.mock('@/server/services/taskRecommendation/service', () => ({
  createTaskRecommendationService: vi.fn(),
  TaskRecommendationNotFoundError: class extends Error {},
}));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));

const CHANNEL = 'test:onboarding-generation-progress:topic-1';

describe('subscribeToOnboardingGenerationProgress', () => {
  beforeEach(() => {
    redis.handler = undefined;
  });

  it('queues a message that arrives after a timed-out wait', async () => {
    const subscription = await subscribeToOnboardingGenerationProgress('topic-1');
    if (!subscription) throw new Error('Expected a Redis subscription');

    const timeout = new AbortController();
    const abandoned = subscription.next(timeout.signal);
    timeout.abort();
    await expect(abandoned).resolves.toBeUndefined();

    redis.handler?.(CHANNEL, JSON.stringify({ eventId: 'event-2', progress: { phase: 'failed' } }));

    await expect(subscription.next()).resolves.toMatchObject({ eventId: 'event-2' });
    await subscription.unsubscribe();
  });
});
