// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface LoadIndexIntegrationModuleOptions {
  featureGateEnabled?: boolean;
  mockEmitSourceEvent?: Mock;
  mockInitModelRuntimeFromDB?: Mock;
  mockProjectObservability?: Mock;
  mockRuntimeFactory?: Mock;
}

const mockRedis = {
  del: vi.fn(),
  expire: vi.fn(),
  hgetall: vi.fn(),
  hset: vi.fn(),
  set: vi.fn(),
};

/**
 * Loads the Agent Signal service entrypoint with one test-scoped module graph.
 *
 * Use when:
 * - Integration tests need different mock boundaries for `index.ts`
 * - Each case must isolate import-time wiring without creating file-level mock pollution
 *
 * Expects:
 * - Optional mocks are passed before the entrypoint import happens
 *
 * Returns:
 * - The imported entrypoint plus the stable mocks used for assertions
 */
const loadIndexIntegrationModule = async (options: LoadIndexIntegrationModuleOptions = {}) => {
  vi.resetModules();
  vi.doUnmock('../featureGate');
  vi.doUnmock('../observability/projector');
  vi.doUnmock('../observability/store');
  vi.doUnmock('../orchestrator');
  vi.doUnmock('../runtime/AgentSignalRuntime');
  vi.doUnmock('../sources');
  vi.doUnmock('@/server/services/agentDocuments');
  vi.doUnmock('@/server/modules/ModelRuntime');

  const persistAgentSignalObservability = vi.fn().mockResolvedValue(undefined);
  const isAgentSignalEnabledForUser = vi.fn().mockResolvedValue(options.featureGateEnabled ?? true);

  vi.doMock('../featureGate', () => ({
    isAgentSignalEnabledForUser,
  }));
  vi.doMock('../observability/store', () => ({
    persistAgentSignalObservability,
  }));

  if (options.mockInitModelRuntimeFromDB) {
    vi.doMock('@/server/modules/ModelRuntime', () => ({
      initModelRuntimeFromDB: options.mockInitModelRuntimeFromDB,
    }));
  }

  if (options.mockEmitSourceEvent) {
    vi.doMock('../sources', () => ({
      emitSourceEvent: options.mockEmitSourceEvent,
    }));
  }

  if (options.mockRuntimeFactory) {
    vi.doMock('../runtime/AgentSignalRuntime', () => ({
      createAgentSignalRuntime: options.mockRuntimeFactory,
    }));
  }

  if (options.mockProjectObservability) {
    vi.doMock('../observability/projector', () => ({
      projectAgentSignalObservability: options.mockProjectObservability,
    }));
  }

  const module = await import('../index');

  return {
    ...module,
    mocks: {
      isAgentSignalEnabledForUser,
      persistAgentSignalObservability,
    },
  };
};

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  (
    globalThis as { __agentSignalRedisClient?: typeof mockRedis | undefined }
  ).__agentSignalRedisClient = undefined;
});

describe('emitAgentSignalSourceEvent integration', () => {
  it('passes the enabled self-iteration policy into immediate source execution', async () => {
    vi.resetModules();

    const executeAgentSignalSourceEvent = vi.fn().mockResolvedValue(undefined);
    const isAgentSignalEnabledForUser = vi.fn().mockResolvedValue(true);

    vi.doMock('../featureGate', () => ({
      isAgentSignalEnabledForUser,
    }));
    vi.doMock('../orchestrator', () => ({
      executeAgentSignalSourceEvent,
    }));

    const { emitAgentSignalSourceEvent } = await import('../emitter');

    await emitAgentSignalSourceEvent(
      {
        payload: { message: 'Create a reusable skill.', messageId: 'msg-skill' },
        scopeKey: 'topic:topic-1',
        sourceId: 'source-skill',
        sourceType: 'agent.user.message',
        timestamp: 1_710_000_000_000,
      },
      {
        agentId: 'agent-1',
        db: {} as never,
        userId: 'user-1',
      },
    );

    expect(executeAgentSignalSourceEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        policyOptions: {
          skillManagement: {
            selfIterationEnabled: true,
          },
        },
      }),
    );
  });

  it('orchestrates source emission through the runtime boundary', async () => {
    const emitSourceEvent = vi.fn().mockResolvedValue({
      deduped: false,
      source: {
        chain: { chainId: 'chain:eval', rootSourceId: 'eval-source' },
        payload: {},
        scopeKey: 'topic:topic-1',
        sourceId: 'eval-source',
        sourceType: 'agent.user.message',
        timestamp: 1_710_000_000_000,
      },
      trigger: {
        scopeKey: 'topic:topic-1',
        token: 'trigger:eval-source',
        windowEventCount: 1,
      },
    });
    const emitNormalized = vi.fn().mockResolvedValue({
      status: 'completed',
      trace: {
        actions: [],
        results: [],
        signals: [],
        source: {
          chain: { chainId: 'chain:eval', rootSourceId: 'eval-source' },
          payload: {},
          scopeKey: 'topic:topic-1',
          sourceId: 'eval-source',
          sourceType: 'agent.user.message',
          timestamp: 1_710_000_000_000,
        },
      },
    });
    const createAgentSignalRuntime = vi.fn().mockReturnValue({
      emitNormalized,
    });
    const projectAgentSignalObservability = vi.fn().mockReturnValue({
      actions: [],
      results: [],
      signals: [],
      source: {
        chain: { chainId: 'chain:eval', rootSourceId: 'eval-source' },
        payload: {},
        scopeKey: 'topic:topic-1',
        sourceId: 'eval-source',
        sourceType: 'agent.user.message',
        timestamp: 1_710_000_000_000,
      },
    });
    const { emitAgentSignalSourceEvent, mocks } = await loadIndexIntegrationModule({
      mockEmitSourceEvent: emitSourceEvent,
      mockProjectObservability: projectAgentSignalObservability,
      mockRuntimeFactory: createAgentSignalRuntime,
    });

    const result = await emitAgentSignalSourceEvent(
      {
        payload: { message: 'Remember this.', messageId: 'msg-runtime' },
        scopeKey: 'topic:topic-1',
        sourceId: 'eval-agent-signal-basic-memory-1710000000000',
        sourceType: 'agent.user.message',
        timestamp: 1_710_000_000_000,
      },
      {
        agentId: 'agent-1',
        db: {} as never,
        userId: 'user-1',
      },
    );

    expect(result).toBeDefined();
    expect(result?.deduped).toBe(false);
    expect(emitSourceEvent).toHaveBeenCalledTimes(1);
    expect(emitNormalized).toHaveBeenCalledTimes(1);
    expect(mocks.persistAgentSignalObservability).toHaveBeenCalledTimes(1);
  });

  it(
    'projects and persists observability for the real source-to-runtime path',
    { timeout: 10_000 },
    async () => {
      (globalThis as { __agentSignalRedisClient?: typeof mockRedis }).__agentSignalRedisClient =
        mockRedis;
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1);
      mockRedis.hgetall.mockResolvedValue({});
      mockRedis.hset.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      const initModelRuntimeFromDB = vi.fn().mockResolvedValue({
        generateObject: vi.fn().mockResolvedValue({
          confidence: 0.91,
          evidence: [{ cue: 'no durable request', excerpt: 'remember this' }],
          reason: 'the message does not express satisfaction feedback',
          result: 'neutral',
        }),
      });

      const { emitAgentSignalSourceEvent, mocks } = await loadIndexIntegrationModule({
        mockInitModelRuntimeFromDB: initModelRuntimeFromDB,
      });

      const result = await emitAgentSignalSourceEvent(
        {
          payload: {
            intents: ['memory'],
            message: 'remember this',
            messageId: 'msg_1',
          },
          sourceId: 'source_1',
          sourceType: 'agent.user.message',
        },
        {
          agentId: 'agent_1',
          db: {} as never,
          userId: 'user_1',
        },
      );

      expect(result).toBeDefined();
      expect(result?.deduped).toBe(false);

      if (!result || result.deduped) {
        throw new Error('unexpected dedupe');
      }

      expect(result.orchestration.observability.record.sourceType).toBe('agent.user.message');
      expect(result.orchestration.observability.envelope.source.sourceId).toBe('source_1');
      expect(initModelRuntimeFromDB).toHaveBeenCalledTimes(1);
      expect(mocks.persistAgentSignalObservability).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({ sourceId: 'source_1' }),
        }),
      );
    },
  );
});
