import { describe, expect, it, vi } from 'vitest';

import { getDefaultReasonDetail, StreamEventManager } from '../StreamEventManager';

// Mock Redis client
const mockRedis = {
  del: vi.fn(),
  expire: vi.fn(),
  keys: vi.fn(),
  quit: vi.fn(),
  xadd: vi.fn(),
  xread: vi.fn(),
  xrevrange: vi.fn(),
};

vi.mock('../redis', () => ({
  getAgentRuntimeRedisClient: () => mockRedis,
}));

describe('StreamEventManager', () => {
  let streamManager: StreamEventManager;

  beforeEach(() => {
    vi.clearAllMocks();
    streamManager = new StreamEventManager();
  });

  describe('publishAgentRuntimeInit', () => {
    it('should publish agent runtime init event with correct data', async () => {
      const operationId = 'test-operation-id';
      const metadata = {
        agentConfig: { test: true },
        createdAt: '2024-01-01T00:00:00.000Z',
        modelRuntimeConfig: { model: 'gpt-4' },
        status: 'idle',
        totalCost: 0,
        totalSteps: 0,
        userId: 'user-123',
      };

      mockRedis.xadd.mockResolvedValue('event-id-123');

      const result = await streamManager.publishAgentRuntimeInit(operationId, metadata);

      expect(result).toBe('event-id-123');
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        `agent_runtime_stream:${operationId}`,
        'MAXLEN',
        '~',
        '1000',
        '*',
        'type',
        'agent_runtime_init',
        'stepIndex',
        '0',
        'operationId',
        operationId,
        'data',
        JSON.stringify(metadata),
        'timestamp',
        expect.any(String),
      );
    });
  });

  describe('publishAgentRuntimeEnd', () => {
    it('should publish agent runtime end event with correct data', async () => {
      const operationId = 'test-operation-id';
      const stepIndex = 5;
      const finalState = {
        cost: { total: 100 },
        status: 'done',
        stepCount: 5,
      };

      mockRedis.xadd.mockResolvedValue('event-id-456');

      const result = await streamManager.publishAgentRuntimeEnd(operationId, stepIndex, finalState);

      expect(result).toBe('event-id-456');
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        `agent_runtime_stream:${operationId}`,
        'MAXLEN',
        '~',
        '1000',
        '*',
        'type',
        'agent_runtime_end',
        'stepIndex',
        '5',
        'operationId',
        operationId,
        'data',
        JSON.stringify({
          finalState,
          operationId,
          phase: 'execution_complete',
          reason: 'completed',
          reasonDetail: 'Agent runtime completed successfully',
        }),
        'timestamp',
        expect.any(String),
      );
    });

    it('should accept custom reason and reasonDetail', async () => {
      const operationId = 'test-operation-id';
      const stepIndex = 3;
      const finalState = { status: 'error' };
      const reason = 'error';
      const reasonDetail = 'Agent failed due to timeout';

      mockRedis.xadd.mockResolvedValue('event-id-789');

      await streamManager.publishAgentRuntimeEnd(
        operationId,
        stepIndex,
        finalState,
        reason,
        reasonDetail,
      );

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        operationId,
        'data',
        JSON.stringify({
          finalState,
          operationId,
          phase: 'execution_complete',
          reason,
          reasonDetail,
        }),
        expect.any(String),
        expect.any(String),
      );
    });

    it('should derive error reasonDetail from finalState when omitted', async () => {
      const operationId = 'test-operation-id';
      const stepIndex = 3;
      const finalState = {
        error: {
          message: 'Invalid provider API key',
          type: 'InvalidProviderAPIKey',
        },
        status: 'error',
      };

      mockRedis.xadd.mockResolvedValue('event-id-790');

      await streamManager.publishAgentRuntimeEnd(operationId, stepIndex, finalState, 'error');

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        operationId,
        'data',
        JSON.stringify({
          finalState,
          operationId,
          phase: 'execution_complete',
          reason: 'error',
          reasonDetail: 'Invalid provider API key',
        }),
        expect.any(String),
        expect.any(String),
      );
    });
  });

  describe('getDefaultReasonDetail', () => {
    it('should return success message for non-error reasons', () => {
      expect(getDefaultReasonDetail({}, 'completed')).toBe('Agent runtime completed successfully');
      expect(getDefaultReasonDetail({}, undefined)).toBe('Agent runtime completed successfully');
    });

    it('should extract from ChatMessageError format (body.error.message)', () => {
      const state = {
        error: {
          body: { error: { message: 'Rate limit exceeded' } },
          message: 'ProviderBizError',
          type: 'ProviderBizError',
        },
      };
      expect(getDefaultReasonDetail(state, 'error')).toBe('Rate limit exceeded');
    });

    it('should extract from ChatMessageError format (body.message)', () => {
      const state = {
        error: {
          body: { message: 'Service unavailable' },
          message: 'error',
          type: 'InternalServerError',
        },
      };
      expect(getDefaultReasonDetail(state, 'error')).toBe('Service unavailable');
    });

    it('should extract from ChatCompletionErrorPayload format (error.message)', () => {
      const state = {
        error: {
          error: { message: 'Budget exceeded' },
          errorType: 'InsufficientBudgetForModel',
          provider: 'lobehub',
        },
      };
      expect(getDefaultReasonDetail(state, 'error')).toBe('Budget exceeded');
    });

    it('should extract from nested ChatCompletionErrorPayload (error.error.message)', () => {
      const state = {
        error: {
          error: {
            error: { message: '无效的令牌' },
            message: '无效的令牌',
            status: 401,
          },
          errorType: 'InvalidProviderAPIKey',
        },
      };
      expect(getDefaultReasonDetail(state, 'error')).toBe('无效的令牌');
    });

    it('should skip [object Object] and fallback to type', () => {
      const state = {
        error: {
          message: '[object Object]',
          type: 'ProviderBizError',
        },
      };
      expect(getDefaultReasonDetail(state, 'error')).toBe('ProviderBizError');
    });

    it('should use direct message when it is a real string', () => {
      const state = {
        error: { message: 'Connection timeout', type: 'NetworkError' },
      };
      expect(getDefaultReasonDetail(state, 'error')).toBe('Connection timeout');
    });

    it('should fallback to default message when error is empty', () => {
      expect(getDefaultReasonDetail({}, 'error')).toBe('Agent runtime failed');
      expect(getDefaultReasonDetail({ error: {} }, 'error')).toBe('Agent runtime failed');
      expect(getDefaultReasonDetail(null, 'error')).toBe('Agent runtime failed');
    });

    it('should handle interrupted reason', () => {
      const state = { error: { message: 'User cancelled' } };
      expect(getDefaultReasonDetail(state, 'interrupted')).toBe('User cancelled');
    });

    it('should fallback for interrupted without error', () => {
      expect(getDefaultReasonDetail({}, 'interrupted')).toBe('Agent runtime interrupted');
    });
  });
});
