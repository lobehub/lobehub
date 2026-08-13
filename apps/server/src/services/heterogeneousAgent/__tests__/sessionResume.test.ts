// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';

import { HeterogeneousAgentService, HeterogeneousPersistenceHandler } from '..';
import { __resetOperationStatesForTesting } from '../HeterogeneousPersistenceHandler';

const createSilentStreamManager = (): IStreamEventManager =>
  ({
    publishStreamEvent: vi.fn(async () => 'ok'),
  }) as unknown as IStreamEventManager;

describe('HeterogeneousAgentService — phase 2c session id persistence + resume', () => {
  beforeEach(() => __resetOperationStatesForTesting());
  afterEach(() => __resetOperationStatesForTesting());

  describe('heteroFinish persists an operation-scoped session id', () => {
    it('writes the CLI session id to topic.metadata.heteroSessionId', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-1',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-1',
            operationId: 'op-1',
          },
        },
      }));

      // Real handler so we exercise the persistSessionId path end-to-end
      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });

      // Seed in-memory state by ingesting one event so finish has something to drain
      await handler.ingest({
        events: [
          {
            data: { chunkType: 'text', content: 'hi' },
            operationId: 'op-1',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
        ],
        operationId: 'op-1',
        topicId: 'topic-1',
      });

      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: handler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById } as any,
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-1',
        result: 'success',
        sessionId: 'cc-session-fresh',
        topicId: 'topic-1',
      });

      expect(updateHeterogeneousSessionIfMatches).toHaveBeenCalledWith(
        'topic-1',
        'op-1',
        'cc-session-fresh',
      );
    });

    it('skips the metadata write when no sessionId is provided on success', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-2',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-2',
            operationId: 'op-2',
          },
        },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });
      await handler.ingest({
        events: [
          {
            data: {},
            operationId: 'op-2',
            stepIndex: 0,
            timestamp: 1,
            type: 'agent_runtime_end',
          },
        ],
        operationId: 'op-2',
        topicId: 'topic-2',
      });

      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: handler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById } as any,
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-2',
        result: 'success',
        // no sessionId — CLI run aborted before init landed, or codex without resume
        topicId: 'topic-2',
      });

      expect(updateHeterogeneousSessionIfMatches).not.toHaveBeenCalled();
    });

    it('clears stale heteroSessionId when result=error and no sessionId (sandbox recycled)', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-stale',
        metadata: {
          heteroSessionId: 'cc-dead-session',
          runningOperation: { assistantMessageId: 'asst-s', operationId: 'op-stale' },
        },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });

      await handler.ingest({
        events: [
          {
            data: { chunkType: 'text', content: '' },
            operationId: 'op-stale',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
        ],
        operationId: 'op-stale',
        topicId: 'topic-stale',
      });

      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: handler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById } as any,
      });

      // Simulate: sandbox was recycled, CC exited before emitting system.init
      // so `sessionId` is undefined.
      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-stale',
        result: 'error',
        // no sessionId — CC never initialized (resume failed)
        topicId: 'topic-stale',
      });

      // Must clear the stale session id so the next turn starts fresh
      expect(updateHeterogeneousSessionIfMatches).toHaveBeenCalledWith(
        'topic-stale',
        'op-stale',
        undefined,
      );
    });

    it('persists sessionId even when result=error (so the next run can still resume context)', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-3',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-3',
            operationId: 'op-3',
          },
        },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });
      await handler.ingest({
        events: [
          {
            data: {},
            operationId: 'op-3',
            stepIndex: 0,
            timestamp: 1,
            type: 'agent_runtime_init',
          },
        ],
        operationId: 'op-3',
        topicId: 'topic-3',
      });

      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: handler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById } as any,
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        error: { message: 'rate limited', type: 'AgentRuntimeError' },
        operationId: 'op-3',
        result: 'error',
        sessionId: 'cc-session-partial',
        topicId: 'topic-3',
      });

      expect(updateHeterogeneousSessionIfMatches).toHaveBeenCalledWith(
        'topic-3',
        'op-3',
        'cc-session-partial',
      );
    });

    it('scopes the session update to the current operation', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-4',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-4',
            operationId: 'op-4',
          },
          workingDirectory: '/Users/dev/project',
        },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });
      await handler.ingest({
        events: [
          {
            data: {},
            operationId: 'op-4',
            stepIndex: 0,
            timestamp: 1,
            type: 'agent_runtime_init',
          },
        ],
        operationId: 'op-4',
        topicId: 'topic-4',
      });

      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: handler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById } as any,
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-4',
        result: 'success',
        sessionId: 'cc-session-resume-target',
        topicId: 'topic-4',
      });

      expect(updateHeterogeneousSessionIfMatches).toHaveBeenCalledWith(
        'topic-4',
        'op-4',
        'cc-session-resume-target',
      );
    });

    it('session persistence failure does not poison heteroFinish (terminal event still publishes)', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => {
        throw new Error('connection lost');
      });
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-5',
        metadata: {
          runningOperation: {
            assistantMessageId: 'asst-5',
            operationId: 'op-5',
          },
        },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });
      await handler.ingest({
        events: [
          {
            data: {},
            operationId: 'op-5',
            stepIndex: 0,
            timestamp: 1,
            type: 'agent_runtime_init',
          },
        ],
        operationId: 'op-5',
        topicId: 'topic-5',
      });

      const stream = createSilentStreamManager();
      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: handler,
        streamEventManager: stream,
        topicModel: { findById } as any,
      });

      // Should not throw — sessionId persistence is best-effort
      await expect(
        service.heteroFinish({
          agentType: 'claude-code',
          operationId: 'op-5',
          result: 'success',
          sessionId: 'cc-session-x',
          topicId: 'topic-5',
        }),
      ).resolves.not.toThrow();

      // Terminal agent_runtime_end still published
      expect(stream.publishStreamEvent).toHaveBeenCalled();
    });
  });

  describe('eager session-id persistence on stream_start (survives watchdog abandon)', () => {
    it('stores a thread session on its assistant anchor without overwriting the main topic', async () => {
      const updateTopicMetadata = vi.fn(async () => undefined);
      const updateMessageMetadata = vi.fn(async () => undefined);
      const findById = vi.fn(async () => ({
        agentId: 'agent-1',
        id: 'asst-thread-a',
        metadata: null,
        threadId: 'thread-a',
        topicId: 'topic-shared',
      }));
      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById,
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
          updateMetadata: updateMessageMetadata,
        } as any,
        threadModel: {} as any,
        topicModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            id: 'topic-shared',
            metadata: {
              heteroSessionId: 'main-session',
              runningOperation: {
                assistantMessageId: 'asst-thread-a',
                operationId: 'op-thread-a',
                threadId: 'thread-a',
              },
            },
          })),
          updateMetadata: updateTopicMetadata,
        } as any,
      });

      await handler.ingest({
        assistantMessageId: 'asst-thread-a',
        events: [
          {
            data: { sessionId: 'thread-a-session' },
            operationId: 'op-thread-a',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_start',
          },
        ],
        operationId: 'op-thread-a',
        topicId: 'topic-shared',
      });

      expect(updateMessageMetadata).toHaveBeenCalledWith('asst-thread-a', {
        heteroSessionId: 'thread-a-session',
      });
      expect(updateTopicMetadata).not.toHaveBeenCalled();
    });

    it('clears only the failed thread anchor session', async () => {
      const removeMetadataKey = vi.fn(async () => undefined);
      const updateTopicMetadata = vi.fn(async () => undefined);
      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            id: 'asst-thread-a',
            metadata: null,
            threadId: 'thread-a',
            topicId: 'topic-shared',
          })),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          removeMetadataKey,
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            id: 'topic-shared',
            metadata: {
              heteroSessionId: 'main-session',
              runningOperation: {
                assistantMessageId: 'asst-thread-a',
                operationId: 'op-thread-a',
                threadId: 'thread-a',
              },
            },
          })),
          updateMetadata: updateTopicMetadata,
        } as any,
      });
      await handler.ingest({
        assistantMessageId: 'asst-thread-a',
        events: [
          {
            data: { chunkType: 'text', content: '' },
            operationId: 'op-thread-a',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_chunk',
          },
        ],
        operationId: 'op-thread-a',
        topicId: 'topic-shared',
      });

      await handler.finish({
        operationId: 'op-thread-a',
        result: 'error',
        topicId: 'topic-shared',
      });

      expect(removeMetadataKey).toHaveBeenCalledWith('asst-thread-a', 'heteroSessionId');
      expect(updateTopicMetadata).not.toHaveBeenCalled();
    });

    it('recovers thread scope from the seeded assistant after runningOperation was cleared', async () => {
      const updateMessageMetadata = vi.fn(async () => undefined);
      const updateTopicMetadata = vi.fn(async () => undefined);
      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            content: '',
            id: 'asst-thread-race',
            metadata: { heteroOperation: { operationId: 'op-thread-race' } },
            threadId: 'thread-race',
            topicId: 'topic-shared',
          })),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
          updateMetadata: updateMessageMetadata,
        } as any,
        threadModel: {} as any,
        topicModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            id: 'topic-shared',
            metadata: {
              heteroSessionId: 'main-session',
              heteroSessionOperationId: 'op-thread-race',
              runningOperation: null,
            },
          })),
          updateMetadata: updateTopicMetadata,
        } as any,
      });

      await handler.finish({
        assistantMessageId: 'asst-thread-race',
        error: { message: 'run failed', type: 'AgentRuntimeError' },
        operationId: 'op-thread-race',
        result: 'error',
        sessionId: 'thread-race-session',
        topicId: 'topic-shared',
      });

      expect(updateMessageMetadata).toHaveBeenCalledWith('asst-thread-race', {
        heteroSessionId: 'thread-race-session',
      });
      expect(updateTopicMetadata).not.toHaveBeenCalledWith(
        'topic-shared',
        expect.objectContaining({ heteroSessionId: expect.anything() }),
      );
    });

    it('persists a successful cold-finish session after runningOperation was cleared', async () => {
      const updateMessageMetadata = vi.fn(async () => undefined);
      const updateTopicMetadata = vi.fn(async () => undefined);
      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            content: 'done',
            id: 'asst-thread-success',
            metadata: { heteroOperation: { operationId: 'op-thread-success' } },
            threadId: 'thread-success',
            topicId: 'topic-shared',
          })),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
          updateMetadata: updateMessageMetadata,
        } as any,
        threadModel: {} as any,
        topicModel: {
          findById: vi.fn(async () => ({
            agentId: 'agent-1',
            id: 'topic-shared',
            metadata: {
              heteroSessionOperationId: 'op-thread-success',
              runningOperation: null,
            },
          })),
          updateMetadata: updateTopicMetadata,
        } as any,
      });

      await handler.finish({
        assistantMessageId: 'asst-thread-success',
        operationId: 'op-thread-success',
        result: 'success',
        sessionId: 'thread-success-session',
        topicId: 'topic-shared',
      });

      expect(updateMessageMetadata).toHaveBeenCalledWith('asst-thread-success', {
        heteroSessionId: 'thread-success-session',
      });
      expect(updateTopicMetadata).not.toHaveBeenCalled();
    });

    it('uses the durable internal binding without touching a parent running operation', async () => {
      const updateMessageMetadata = vi.fn(async () => undefined);
      const updateTopicMetadata = vi.fn(async () => undefined);
      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => ({
            agentId: 'child-agent',
            content: '',
            id: 'asst-child',
            metadata: {
              heteroOperation: {
                internalIsolation: true,
                operationId: 'op-child',
              },
            },
            threadId: 'thread-child',
            topicId: 'topic-parent',
          })),
          findLatestAssistantMessageByThread: vi.fn(async () => ({ id: 'asst-child' })),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
          updateMetadata: updateMessageMetadata,
        } as any,
        threadModel: { queryByTopicId: vi.fn(async () => []) } as any,
        topicModel: {
          findById: vi.fn(async () => ({
            agentId: 'parent-agent',
            id: 'topic-parent',
            metadata: {
              runningOperation: {
                assistantMessageId: 'asst-parent',
                operationId: 'op-parent',
              },
            },
          })),
          updateMetadata: updateTopicMetadata,
        } as any,
      });

      await handler.ingest({
        assistantMessageId: 'asst-child',
        events: [
          {
            data: { sessionId: 'child-session' },
            operationId: 'op-child',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_start',
          },
        ],
        operationId: 'op-child',
        topicId: 'topic-parent',
      });

      expect(updateMessageMetadata).toHaveBeenCalledWith('asst-child', {
        heteroSessionId: 'child-session',
      });
      expect(updateTopicMetadata).not.toHaveBeenCalled();
    });

    it('persists heteroSessionId as soon as stream_start reports it, without waiting for heteroFinish', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-abandon',
        metadata: {
          runningOperation: { assistantMessageId: 'asst-a', operationId: 'op-abandon' },
        },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });

      // Only a stream_start reporting the CC session id — NO heteroFinish. This
      // is the inactivity-watchdog path: the run starts, emits its session id,
      // then gets abandoned by AbandonOperationService (which never calls finish).
      await handler.ingest({
        events: [
          {
            data: { sessionId: 'cc-live-session' },
            operationId: 'op-abandon',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_start',
          },
        ],
        operationId: 'op-abandon',
        topicId: 'topic-abandon',
      });

      // The resume token is already on topic.metadata — the next turn can resume.
      expect(updateHeterogeneousSessionIfMatches).toHaveBeenCalledWith(
        'topic-abandon',
        'op-abandon',
        'cc-live-session',
      );
    });

    it('does not re-write when stream_start repeats the same session id', async () => {
      const updateHeterogeneousSessionIfMatches = vi.fn(async () => true);
      const findById = vi.fn(async () => ({
        agentId: null,
        id: 'topic-dedupe',
        metadata: { runningOperation: { assistantMessageId: 'asst-d', operationId: 'op-dedupe' } },
      }));

      const handler = new HeterogeneousPersistenceHandler({
        messageModel: {
          findById: vi.fn(async () => null),
          getLatestSpineMessageId: vi.fn(async () => null),
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateHeterogeneousSessionIfMatches } as any,
      });

      await handler.ingest({
        events: [
          {
            data: { sessionId: 'cc-same' },
            operationId: 'op-dedupe',
            stepIndex: 0,
            timestamp: 1,
            type: 'stream_start',
          },
          {
            data: { sessionId: 'cc-same' },
            operationId: 'op-dedupe',
            stepIndex: 1,
            timestamp: 2,
            type: 'stream_start',
          },
        ],
        operationId: 'op-dedupe',
        topicId: 'topic-dedupe',
      });

      expect(updateHeterogeneousSessionIfMatches).toHaveBeenCalledTimes(1);
    });
  });

  describe('getHeterogeneousResumeSessionId', () => {
    const buildService = (findByIdImpl: (id: string) => Promise<any>) => {
      const findById = vi.fn(findByIdImpl);
      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        persistenceHandler: {
          finish: vi.fn(async () => {}),
          ingest: vi.fn(async () => {}),
        } as unknown as HeterogeneousPersistenceHandler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById } as any,
      });
      return { findById, service };
    };

    it('returns the persisted heteroSessionId for the topic', async () => {
      const { findById, service } = buildService(async (id) => ({
        agentId: null,
        id,
        metadata: {
          heteroSessionId: 'cc-session-aaaa',
          runningOperation: { assistantMessageId: 'asst', operationId: 'op' },
        },
      }));

      const sessionId = await service.getHeterogeneousResumeSessionId('topic-resume');
      expect(sessionId).toBe('cc-session-aaaa');
      expect(findById).toHaveBeenCalledWith('topic-resume');
    });

    it('reads an exact thread session without consulting topic metadata', async () => {
      const findLatestHeterogeneousSessionId = vi.fn(async () => 'thread-a-session');
      const findTopicById = vi.fn(async () => ({
        metadata: { heteroSessionId: 'main-session' },
      }));
      const service = new HeterogeneousAgentService({} as any, 'user-1', {
        messageModel: { findLatestHeterogeneousSessionId } as any,
        persistenceHandler: {
          finish: vi.fn(async () => {}),
          ingest: vi.fn(async () => {}),
        } as unknown as HeterogeneousPersistenceHandler,
        streamEventManager: createSilentStreamManager(),
        topicModel: { findById: findTopicById } as any,
      });

      await expect(
        service.getHeterogeneousResumeSessionId('topic-shared', 'thread-a', 'asst-current'),
      ).resolves.toBe('thread-a-session');
      expect(findLatestHeterogeneousSessionId).toHaveBeenCalledWith({
        excludeMessageId: 'asst-current',
        threadId: 'thread-a',
        topicId: 'topic-shared',
      });
      expect(findTopicById).not.toHaveBeenCalled();
    });

    it('returns undefined when no prior run persisted a session id', async () => {
      const { service } = buildService(async (id) => ({
        agentId: null,
        id,
        metadata: {
          runningOperation: { assistantMessageId: 'asst', operationId: 'op' },
          // no heteroSessionId
        },
      }));
      expect(await service.getHeterogeneousResumeSessionId('topic-no-session')).toBeUndefined();
    });

    it('returns undefined for an unknown topic', async () => {
      const { service } = buildService(async () => null);
      expect(await service.getHeterogeneousResumeSessionId('topic-missing')).toBeUndefined();
    });

    it('returns undefined when topic has no metadata', async () => {
      const { service } = buildService(async (id) => ({ agentId: null, id, metadata: null }));
      expect(await service.getHeterogeneousResumeSessionId('topic-bare')).toBeUndefined();
    });
  });
});
