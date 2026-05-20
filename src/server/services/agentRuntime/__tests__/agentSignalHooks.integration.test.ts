// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

interface AgentSignalRedisTestGlobal {
  __agentSignalRedisClient?: typeof mockRedis | null;
}

const mockRedis = {
  del: vi.fn(),
  expire: vi.fn(),
  hgetall: vi.fn(),
  hset: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'http://localhost:3010' } }));
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    update: vi.fn(),
  })),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({
    createAgentOperation: vi.fn(),
    getOperationMetadata: vi.fn(),
    loadAgentState: vi.fn(),
    releaseStepLock: vi.fn().mockResolvedValue(undefined),
    saveAgentState: vi.fn(),
    saveStepResult: vi.fn(),
    tryClaimStep: vi.fn().mockResolvedValue(true),
  })),
  createStreamEventManager: vi.fn(() => ({
    cleanupOperation: vi.fn(),
    publishAgentRuntimeEnd: vi.fn(),
    publishAgentRuntimeInit: vi.fn(),
    publishStreamEvent: vi.fn(),
  })),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(() => ({})),
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: {} }));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(() => ({
    getImpl: vi.fn(() => ({})),
    scheduleMessage: vi.fn(),
  })),
}));
vi.mock('@/server/services/queue/impls', () => ({
  LocalQueueServiceImpl: class {},
  isQueueAgentRuntimeEnabled: vi.fn().mockReturnValue(false),
}));
vi.mock('@/server/services/agentSignal/featureGate', () => ({
  isAgentSignalEnabledForUser: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@lobechat/builtin-tools/dynamicInterventionAudits', () => ({
  dynamicInterventionAudits: [],
}));

describe('AgentRuntimeService Agent Signal hook integration', () => {
  it(
    'emits source events for beforeStep and afterStep boundaries',
    { timeout: 20_000 },
    async () => {
      (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1);
      mockRedis.hgetall.mockResolvedValue({});
      mockRedis.hset.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const { AgentRuntimeService } = await import('../AgentRuntimeService');
      const service = new AgentRuntimeService({} as any, 'user-1', { queueService: null });
      const coordinator = (service as any).coordinator;

      vi.spyOn(coordinator, 'loadAgentState').mockResolvedValue({
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        messages: [{ content: 'hello', role: 'user' }],
        metadata: {
          agentId: 'agent-1',
          topicId: 'topic-1',
          userId: 'user-1',
        },
        operationId: 'op-1',
        status: 'running',
        stepCount: 0,
        usage: { llm: { tokens: { total: 10 } }, tools: { totalCalls: 0 } },
      });

      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({
        runtime: {
          step: vi.fn().mockResolvedValue({
            events: [{ result: { content: 'done' }, type: 'llm_result' }],
            newState: {
              createdAt: new Date().toISOString(),
              metadata: {
                agentId: 'agent-1',
                topicId: 'topic-1',
                userId: 'user-1',
              },
              messages: [
                { content: 'hello', role: 'user' },
                { content: 'done', role: 'assistant' },
              ],
              status: 'done',
              stepCount: 1,
              usage: { llm: { apiCalls: 1, tokens: { total: 10 } }, tools: { totalCalls: 0 } },
            },
            nextContext: undefined,
          }),
        },
      });

      await service.executeStep({
        context: { phase: 'user_input' } as any,
        operationId: 'op-1',
        stepIndex: 0,
      });

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('runtime.before_step'),
        '1',
        'EX',
        300,
        'NX',
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('runtime.after_step'),
        '1',
        'EX',
        300,
        'NX',
      );
      expect(mockRedis.hset).toHaveBeenCalledWith('agent-signal:window:topic:topic-1', {
        eventCount: '1',
        lastEventAt: expect.any(String),
        lastEventId: expect.stringContaining('runtime.before_step'),
      });
    },
  );

  /**
   * @example
   * await service.executeStep({ context, operationId: 'op-1', stepIndex: 0 });
   * expect(savedSnapshot.steps[0].events.some((event) => event.type === 'agent_signal.source')).toBe(true);
   */
  it('records agent signal trace events into snapshot steps', { timeout: 10_000 }, async () => {
    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.hgetall.mockResolvedValue({});
    mockRedis.hset.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    let partialSnapshot: any = null;
    let savedSnapshot: any = null;
    const snapshotStore = {
      loadPartial: vi.fn(async () => partialSnapshot),
      removePartial: vi.fn(async () => {
        partialSnapshot = null;
      }),
      save: vi.fn(async (snapshot) => {
        savedSnapshot = snapshot;
      }),
      savePartial: vi.fn(async (_operationId, partial) => {
        partialSnapshot = partial;
      }),
    };

    const { AgentRuntimeService } = await import('../AgentRuntimeService');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      snapshotStore: snapshotStore as any,
    });
    const coordinator = (service as any).coordinator;

    vi.spyOn(coordinator, 'loadAgentState').mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messages: [{ content: 'hello', role: 'user' }],
      metadata: {
        agentId: 'agent-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      operationId: 'op-1',
      status: 'running',
      stepCount: 0,
      usage: { llm: { tokens: { total: 10 } }, tools: { totalCalls: 0 } },
    });

    vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({
      runtime: {
        step: vi.fn().mockResolvedValue({
          events: [{ result: { content: 'done' }, type: 'llm_result' }],
          newState: {
            createdAt: new Date().toISOString(),
            metadata: {
              agentId: 'agent-1',
              topicId: 'topic-1',
              userId: 'user-1',
            },
            messages: [
              { content: 'hello', role: 'user' },
              { content: 'done', role: 'assistant' },
            ],
            status: 'done',
            stepCount: 1,
            usage: { llm: { apiCalls: 1, tokens: { total: 10 } }, tools: { totalCalls: 0 } },
          },
          nextContext: undefined,
        }),
      },
    });

    await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-1',
      stepIndex: 0,
    });

    expect(savedSnapshot).toBeDefined();
    expect(savedSnapshot.steps).toHaveLength(1);
    expect(savedSnapshot.steps[0].events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent_signal.source' }),
        expect.objectContaining({
          data: expect.objectContaining({ sourceId: 'op-1:complete:done' }),
          type: 'agent_signal.source',
        }),
      ]),
    );
  });

  /**
   * @example
   * await service.executeStep({ context, operationId: 'op-1', stepIndex: 0 });
   * expect(savedSnapshot.steps[0].events.some((event) => event.type === 'agent_signal.result')).toBe(true);
   */
  it('keeps completion signal events even when completion hooks fail afterward', async () => {
    (globalThis as AgentSignalRedisTestGlobal).__agentSignalRedisClient = mockRedis;
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.hgetall.mockResolvedValue({});
    mockRedis.hset.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);

    let partialSnapshot: any = null;
    let savedSnapshot: any = null;
    const snapshotStore = {
      loadPartial: vi.fn(async () => partialSnapshot),
      removePartial: vi.fn(async () => {
        partialSnapshot = null;
      }),
      save: vi.fn(async (snapshot) => {
        savedSnapshot = snapshot;
      }),
      savePartial: vi.fn(async (_operationId, partial) => {
        partialSnapshot = partial;
      }),
    };

    const { hookDispatcher } = await import('../hooks');
    const dispatchSpy = vi
      .spyOn(hookDispatcher, 'dispatch')
      .mockRejectedValueOnce(new Error('hook boom'));

    const { AgentRuntimeService } = await import('../AgentRuntimeService');
    const service = new AgentRuntimeService({} as any, 'user-1', {
      queueService: null,
      snapshotStore: snapshotStore as any,
    });
    const coordinator = (service as any).coordinator;

    vi.spyOn(coordinator, 'loadAgentState').mockResolvedValue({
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      messages: [{ content: 'hello', role: 'user' }],
      metadata: {
        _hooks: ['serialized-hook'],
        agentId: 'agent-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      operationId: 'op-1',
      status: 'running',
      stepCount: 0,
      usage: { llm: { tokens: { total: 10 } }, tools: { totalCalls: 0 } },
    });

    vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({
      runtime: {
        step: vi.fn().mockResolvedValue({
          events: [{ result: { content: 'done' }, type: 'llm_result' }],
          newState: {
            createdAt: new Date().toISOString(),
            metadata: {
              _hooks: ['serialized-hook'],
              agentId: 'agent-1',
              topicId: 'topic-1',
              userId: 'user-1',
            },
            messages: [
              { content: 'hello', role: 'user' },
              { content: 'done', role: 'assistant' },
            ],
            status: 'done',
            stepCount: 1,
            usage: { llm: { apiCalls: 1, tokens: { total: 10 } }, tools: { totalCalls: 0 } },
          },
          nextContext: undefined,
        }),
      },
    });

    await service.executeStep({
      context: { phase: 'user_input' } as any,
      operationId: 'op-1',
      stepIndex: 0,
    });

    expect(dispatchSpy).toHaveBeenCalled();
    expect(savedSnapshot.steps[0].events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ sourceId: 'op-1:complete:done' }),
          type: 'agent_signal.source',
        }),
      ]),
    );
  });
});
