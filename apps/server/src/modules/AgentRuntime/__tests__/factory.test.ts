import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentStateManager, createStreamEventManager, isRedisAvailable } from '../factory';

const {
  MockAgentStateManager,
  MockGatewayStreamNotifier,
  MockStreamEventManager,
  mockAppEnv,
  mockGetAgentRuntimeRedisClient,
  mockInMemoryAgentStateManager,
  mockInMemoryStreamEventManager,
} = vi.hoisted(() => ({
  MockAgentStateManager: vi.fn(() => ({ kind: 'redis-state-manager' })),
  MockGatewayStreamNotifier: vi.fn((inner: any, url: string, token: string) => ({
    inner,
    kind: 'gateway-stream-notifier',
    token,
    url,
  })),
  MockStreamEventManager: vi.fn(() => ({ kind: 'redis-stream-event-manager' })),
  mockAppEnv: {
    AGENT_GATEWAY_SERVICE_TOKEN: undefined as string | undefined,
    AGENT_GATEWAY_URL: 'https://agent-gateway.lobehub.com',
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

vi.mock('../GatewayStreamNotifier', () => ({
  GatewayStreamNotifier: MockGatewayStreamNotifier,
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
    beforeEach(() => {
      mockAppEnv.AGENT_GATEWAY_SERVICE_TOKEN = undefined;
      mockAppEnv.AGENT_GATEWAY_URL = 'https://agent-gateway.lobehub.com';
    });

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

    it('wraps with GatewayStreamNotifier when AGENT_GATEWAY_SERVICE_TOKEN is set', () => {
      mockAppEnv.AGENT_GATEWAY_SERVICE_TOKEN = 'my-token';
      mockGetAgentRuntimeRedisClient.mockReturnValue({ ping: vi.fn() });

      const result = createStreamEventManager() as any;

      expect(result.kind).toBe('gateway-stream-notifier');
      expect(result.inner).toEqual({ kind: 'redis-stream-event-manager' });
      expect(result.token).toBe('my-token');
      expect(result.url).toBe('https://agent-gateway.lobehub.com');
    });

    it('uses custom AGENT_GATEWAY_URL when set', () => {
      mockAppEnv.AGENT_GATEWAY_SERVICE_TOKEN = 'my-token';
      mockAppEnv.AGENT_GATEWAY_URL = 'https://custom-gateway.example.com';
      mockGetAgentRuntimeRedisClient.mockReturnValue({ ping: vi.fn() });

      const result = createStreamEventManager() as any;

      expect(result.kind).toBe('gateway-stream-notifier');
      expect(result.url).toBe('https://custom-gateway.example.com');
    });

    it('wraps in-memory manager with gateway when no Redis', () => {
      mockAppEnv.AGENT_GATEWAY_SERVICE_TOKEN = 'my-token';

      const result = createStreamEventManager() as any;

      expect(result.kind).toBe('gateway-stream-notifier');
      expect(result.inner).toBe(mockInMemoryStreamEventManager);
    });

    it('does not wrap when AGENT_GATEWAY_SERVICE_TOKEN is not set', () => {
      mockGetAgentRuntimeRedisClient.mockReturnValue({ ping: vi.fn() });

      const result = createStreamEventManager() as any;

      expect(result.kind).toBe('redis-stream-event-manager');
      expect(MockGatewayStreamNotifier).not.toHaveBeenCalled();
    });
  });
});
