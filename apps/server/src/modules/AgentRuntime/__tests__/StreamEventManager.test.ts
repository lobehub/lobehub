import { describe, expect, it, vi } from 'vitest';

import {
  getDefaultReasonDetail,
  StreamEventManager,
  stripFinalStateInEventData,
} from '../StreamEventManager';

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

      const result = await streamManager.publishAgentRuntimeEnd({
        finalState,
        operationId,
        stepIndex,
      });

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

    // agent_runtime_end optionally carries the canonical UIChatMessage[]
    // snapshot so the client can use the pushed payload as Source of Truth
    // instead of refetching from DB.
    it('should include uiMessages in serialized data when provided', async () => {
      const operationId = 'test-operation-id';
      const stepIndex = 5;
      const finalState = { status: 'done', stepCount: 5 };
      const uiMessages = [{ id: 'msg_a', role: 'assistantGroup' }] as any;

      mockRedis.xadd.mockResolvedValue('event-id-ui');

      await streamManager.publishAgentRuntimeEnd({
        finalState,
        operationId,
        reason: 'done',
        stepIndex,
        uiMessages,
      });

      // Find the serialized `data` argument inline so this test stays robust
      // if other positional args shift around.
      const dataArg = mockRedis.xadd.mock.calls[0]?.find(
        (a: any) => typeof a === 'string' && a.startsWith('{'),
      );
      const parsed = JSON.parse(dataArg);
      expect(parsed.uiMessages).toEqual(uiMessages);
      expect(parsed.finalState).toEqual(finalState);
    });

    it('should omit uiMessages from serialized data when not provided', async () => {
      const operationId = 'test-operation-id';
      const finalState = { status: 'done', stepCount: 3 };

      mockRedis.xadd.mockResolvedValue('event-id-noui');

      await streamManager.publishAgentRuntimeEnd({ finalState, operationId, stepIndex: 3 });

      const dataArg = mockRedis.xadd.mock.calls[0]?.find(
        (a: any) => typeof a === 'string' && a.startsWith('{'),
      );
      const parsed = JSON.parse(dataArg);
      expect(parsed).not.toHaveProperty('uiMessages');
    });

    it('should accept custom reason and reasonDetail', async () => {
      const operationId = 'test-operation-id';
      const stepIndex = 3;
      const finalState = { status: 'error' };
      const reason = 'error';
      const reasonDetail = 'Agent failed due to timeout';

      mockRedis.xadd.mockResolvedValue('event-id-789');

      await streamManager.publishAgentRuntimeEnd({
        finalState,
        operationId,
        reason,
        reasonDetail,
        stepIndex,
      });

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

      await streamManager.publishAgentRuntimeEnd({
        finalState,
        operationId,
        reason: 'error',
        stepIndex,
      });

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

    // Heavy reconstructible fields (notably `messages` with
    // compressedGroup envelopes) must be stripped before xadd so a
    // single event can't blow past Upstash's 10 MB request limit.
    it('strips messages + tool-set fields from finalState before xadd', async () => {
      const operationId = 'test-operation-id';
      const messages = [
        { content: 'msg', role: 'user' },
        { content: 'reply', role: 'assistant' },
      ];
      const finalState = {
        cost: { total: 42 },
        error: { message: 'boom', type: 'BoomError' },
        messages,
        operationToolSet: { enabledToolIds: ['x'] },
        status: 'error',
        stepCount: 4,
        toolManifestMap: { x: { name: 'x' } },
        toolSourceMap: { x: 'plugin' },
        tools: [{ name: 'x' }],
        usage: { llm: { tokens: { total: 100 } } },
      };

      mockRedis.xadd.mockResolvedValue('event-id-strip');

      await streamManager.publishAgentRuntimeEnd({
        finalState,
        operationId,
        reason: 'error',
        stepIndex: 4,
      });

      const dataArg = mockRedis.xadd.mock.calls[0]?.find(
        (a: any) => typeof a === 'string' && a.startsWith('{'),
      );
      const parsed = JSON.parse(dataArg);

      // Stripped: heavy / reconstructible fields gone
      expect(parsed.finalState.messages).toBeUndefined();
      expect(parsed.finalState.operationToolSet).toBeUndefined();
      expect(parsed.finalState.toolManifestMap).toBeUndefined();
      expect(parsed.finalState.toolSourceMap).toBeUndefined();
      expect(parsed.finalState.tools).toBeUndefined();

      // Preserved: lightweight observability fields downstream consumers use
      expect(parsed.finalState.status).toBe('error');
      expect(parsed.finalState.cost).toEqual({ total: 42 });
      expect(parsed.finalState.error).toEqual({ message: 'boom', type: 'BoomError' });
      expect(parsed.finalState.stepCount).toBe(4);
      expect(parsed.finalState.usage).toEqual({ llm: { tokens: { total: 100 } } });

      // reasonDetail derivation runs against the un-stripped in-process
      // finalState passed as a param, so the error message survives.
      expect(parsed.reasonDetail).toBe('boom');
    });
  });

  describe('readEventsOnce', () => {
    it("resolves '$' to the current tail and returns it (not '$') on timeout", async () => {
      // Stream has a tail entry; xread then times out (no newer events).
      mockRedis.xrevrange.mockResolvedValue([['7-0', ['type', 'stream_chunk']]]);
      mockRedis.xread.mockResolvedValue(null);

      const res = await streamManager.readEventsOnce('op-1', '$', 25_000);

      // '$' was resolved to the concrete tail before blocking…
      expect(mockRedis.xrevrange).toHaveBeenCalledWith(
        'agent_runtime_stream:op-1',
        '+',
        '-',
        'COUNT',
        1,
      );
      expect(mockRedis.xread).toHaveBeenCalledWith(
        'BLOCK',
        25_000,
        'STREAMS',
        'agent_runtime_stream:op-1',
        '7-0',
      );
      // …so the timeout hands back the concrete id, keeping the next poll gap-free.
      expect(res).toEqual({ events: [], lastEventId: '7-0' });
    });

    it("resolves '$' on an empty stream to '0'", async () => {
      mockRedis.xrevrange.mockResolvedValue([]);
      mockRedis.xread.mockResolvedValue(null);

      const res = await streamManager.readEventsOnce('op-1', '$');

      expect(mockRedis.xread).toHaveBeenCalledWith(
        'BLOCK',
        expect.any(Number),
        'STREAMS',
        'agent_runtime_stream:op-1',
        '0',
      );
      expect(res).toEqual({ events: [], lastEventId: '0' });
    });

    it('does not resolve an explicit cursor and blocks from it directly', async () => {
      mockRedis.xread.mockResolvedValue(null);

      const res = await streamManager.readEventsOnce('op-1', '5-0');

      expect(mockRedis.xrevrange).not.toHaveBeenCalled();
      expect(mockRedis.xread).toHaveBeenCalledWith(
        'BLOCK',
        expect.any(Number),
        'STREAMS',
        'agent_runtime_stream:op-1',
        '5-0',
      );
      expect(res).toEqual({ events: [], lastEventId: '5-0' });
    });

    it('parses events and advances the cursor to the last id', async () => {
      mockRedis.xread.mockResolvedValue([
        [
          'agent_runtime_stream:op-1',
          [
            [
              '8-0',
              [
                'type',
                'agent_intervention_response',
                'stepIndex',
                '2',
                'operationId',
                'op-1',
                'data',
                JSON.stringify({ toolCallId: 't1' }),
                'timestamp',
                '123',
              ],
            ],
          ],
        ],
      ]);

      const res = await streamManager.readEventsOnce('op-1', '5-0');

      expect(res.lastEventId).toBe('8-0');
      expect(res.events).toHaveLength(1);
      expect(res.events[0]).toMatchObject({
        id: '8-0',
        type: 'agent_intervention_response',
        stepIndex: 2,
        data: { toolCallId: 't1' },
      });
    });
  });

  describe('stripFinalStateInEventData', () => {
    it('returns data unchanged when finalState is absent', () => {
      const data = { phase: 'execution_complete', reason: 'done' };
      expect(stripFinalStateInEventData(data)).toBe(data);
    });

    it('returns data unchanged when finalState is falsy', () => {
      const data = { finalState: null, reason: 'done' };
      expect(stripFinalStateInEventData(data)).toBe(data);
    });

    it('strips reconstructible fields off finalState while preserving others', () => {
      const result = stripFinalStateInEventData({
        finalState: {
          cost: { total: 1 },
          messages: [{ role: 'user' }],
          operationToolSet: {},
          status: 'done',
          toolManifestMap: {},
          toolSourceMap: {},
          tools: [],
        },
        reason: 'done',
      });

      expect(result).toEqual({
        finalState: { cost: { total: 1 }, status: 'done' },
        reason: 'done',
      });
    });

    it('handles non-object data defensively', () => {
      expect(stripFinalStateInEventData(undefined)).toBeUndefined();
      expect(stripFinalStateInEventData(null)).toBeNull();
      expect(stripFinalStateInEventData('chunk')).toBe('chunk');
      expect(stripFinalStateInEventData(123)).toBe(123);
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
