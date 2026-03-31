import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentStateManager, createStreamEventManager, isRedisAvailable } from '../factory';

const {
  MockAgentStateManager,
  MockStreamEventManager,
  mockAppEnv,
  mockGetAgentRuntimeRedisClient,
  mockInMemoryAgentStateManager,
  mockInMemoryStreamEventManager,
} = vi.hoisted(() => ({
  MockAgentStateManager: vi.fn(() => ({ kind: 'redis-state-manager' })),
  MockStreamEventManager: vi.fn(() => ({ kind: 'redis-stream-event-manager' })),
  mockAppEnv: {
    enableQueueAgentRuntime: false,
  },
  mockGetAgentRuntimeRedisClient: vi.fn(),
  mockInMemoryAgentStateManager: { kind: 'in-memory-state-manager' },
  mockInMemoryStreamEventManager: { kind: 'in-memory-stream-event-manager' },
}));

vi.mock('@/envs/app', () => ({
  appEnv: mockAppEnv,
}));

vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: mockGetAgentRuntimeRedisClient,
}));

vi.mock('../InMemoryAgentStateManager', () => ({
  inMemoryAgentStateManager: mockInMemoryAgentStateManager,
}));

vi.mock('../InMemoryStreamEventManager', () => ({
  inMemoryStreamEventManager: mockInMemoryStreamEventManager,
}));

vi.mock('../AgentStateManager', () => ({
  AgentStateManager: MockAgentStateManager,
}));

vi.mock('../StreamEventManager', () => ({
  StreamEventManager: MockStreamEventManager,
}));

describe('AgentRuntime factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppEnv.enableQueueAgentRuntime = false;
    mockGetAgentRuntimeRedisClient.mockReturnValue(null);
  });

  describe('isRedisAvailable', () => {
    it('returns true when a Redis client exists', () => {
      mockGetAgentRuntimeRedisClient.mockReturnValue({ ping: vi.fn() });

      expect(isRedisAvailable()).toBe(true);
    });

    it('returns false when Redis is unavailable', () => {
      mockGetAgentRuntimeRedisClient.mockReturnValue(null);

      expect(isRedisAvailable()).toBe(false);
    });
  });

  describe('createAgentStateManager', () => {
    it('uses in-memory state when queue mode is disabled', () => {
      expect(createAgentStateManager()).toBe(mockInMemoryAgentStateManager);
      expect(MockAgentStateManager).not.toHaveBeenCalled();
    });

    it('uses Redis-backed state when queue mode is enabled and Redis is available', () => {
      mockAppEnv.enableQueueAgentRuntime = true;
      mockGetAgentRuntimeRedisClient.mockReturnValue({ ping: vi.fn() });

      expect(createAgentStateManager()).toEqual({ kind: 'redis-state-manager' });
      expect(MockAgentStateManager).toHaveBeenCalledTimes(1);
    });

    it('throws when queue mode is enabled without Redis', () => {
      mockAppEnv.enableQueueAgentRuntime = true;

      expect(() => createAgentStateManager()).toThrow(
        'Redis is required when AGENT_RUNTIME_MODE=queue. Please configure `REDIS_URL`.',
      );
    });
  });

  describe('createStreamEventManager', () => {
    it('prefers Redis-backed streams when Redis is available in local mode', () => {
      mockGetAgentRuntimeRedisClient.mockReturnValue({ ping: vi.fn() });

      expect(createStreamEventManager()).toEqual({ kind: 'redis-stream-event-manager' });
      expect(MockStreamEventManager).toHaveBeenCalledTimes(1);
    });

    it('falls back to in-memory streams when local mode has no Redis', () => {
      expect(createStreamEventManager()).toBe(mockInMemoryStreamEventManager);
      expect(MockStreamEventManager).not.toHaveBeenCalled();
    });

    it('throws when queue mode is enabled without Redis', () => {
      mockAppEnv.enableQueueAgentRuntime = true;

      expect(() => createStreamEventManager()).toThrow(
        'Redis is required when AGENT_RUNTIME_MODE=queue. Please configure `REDIS_URL`.',
      );
    });
  });
});
