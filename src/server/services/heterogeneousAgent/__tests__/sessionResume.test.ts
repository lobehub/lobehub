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

  describe('heteroFinish persists sessionId via TopicModel.updateMetadata', () => {
    it('writes the CLI session id to topic.metadata.heteroSessionId', async () => {
      const updateMetadata = vi.fn(async () => undefined);
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
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateMetadata } as any,
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
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-1',
        result: 'success',
        sessionId: 'cc-session-fresh',
        topicId: 'topic-1',
      });

      expect(updateMetadata).toHaveBeenCalledWith('topic-1', {
        heteroSessionId: 'cc-session-fresh',
      });
    });

    it('skips the metadata write when no sessionId is provided', async () => {
      const updateMetadata = vi.fn(async () => undefined);
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
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateMetadata } as any,
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
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-2',
        result: 'success',
        // no sessionId — CLI run aborted before init landed, or codex without resume
        topicId: 'topic-2',
      });

      expect(updateMetadata).not.toHaveBeenCalled();
    });

    it('persists sessionId even when result=error (so the next run can still resume context)', async () => {
      const updateMetadata = vi.fn(async () => undefined);
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
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateMetadata } as any,
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
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        error: { message: 'rate limited', type: 'AgentRuntimeError' },
        operationId: 'op-3',
        result: 'error',
        sessionId: 'cc-session-partial',
        topicId: 'topic-3',
      });

      expect(updateMetadata).toHaveBeenCalledWith('topic-3', {
        heteroSessionId: 'cc-session-partial',
      });
    });

    it('topic.metadata.runningOperation is preserved (updateMetadata merges, does not replace)', async () => {
      // This contract is enforced by `TopicModel.updateMetadata` itself
      // (verified in packages/database tests). We just assert the handler
      // calls it with a partial — not the full metadata object.
      const updateMetadata = vi.fn(async () => undefined);
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
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateMetadata } as any,
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
      });

      await service.heteroFinish({
        agentType: 'claude-code',
        operationId: 'op-4',
        result: 'success',
        sessionId: 'cc-session-resume-target',
        topicId: 'topic-4',
      });

      // Critical: passes only the field we want to update; other peers
      // (runningOperation, workingDirectory) are untouched in the patch
      // and TopicModel.updateMetadata's merge semantics preserve them.
      expect(updateMetadata).toHaveBeenCalledTimes(1);
      const call = updateMetadata.mock.calls[0] as unknown as [string, Record<string, unknown>];
      const patch = call[1];
      expect(patch).toEqual({ heteroSessionId: 'cc-session-resume-target' });
      expect(patch).not.toHaveProperty('runningOperation');
      expect(patch).not.toHaveProperty('workingDirectory');
    });

    it('updateMetadata failure does not poison heteroFinish (terminal event still publishes)', async () => {
      const updateMetadata = vi.fn(async () => {
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
          listMessagePluginsByTopic: vi.fn(async () => []),
          update: vi.fn(async () => ({ success: true })),
        } as any,
        threadModel: {} as any,
        topicModel: { findById, updateMetadata } as any,
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
