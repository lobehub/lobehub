// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import type { IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';

import { HeterogeneousAgentService } from '..';
import { HeterogeneousPersistenceHandler } from '../HeterogeneousPersistenceHandler';

/** @example Device continuation selects the child binding even when the source topic has a token. */
describe('native branch resume binding', () => {
  afterEach(() => vi.restoreAllMocks());

  /** @example A continuation thread never resumes its parent topic. */
  it('reads the child native binding without falling back to the source topic', async () => {
    // ROOT CAUSE:
    // Device dispatch read only topic.metadata.heteroSessionId. A branch send
    // therefore resumed and mutated the source native history. Thread-scoped
    // sends must resolve their own binding, including the absence of a binding.
    const db = {} as LobeChatDatabase;
    const topicModel = new TopicModel(db, 'test-user');
    const threadModel = new ThreadModel(db, 'test-user');
    const topicRead = vi.spyOn(topicModel, 'findById').mockResolvedValue({
      id: 'source-topic',
      metadata: { heteroSessionId: 'source-native' },
    } as NonNullable<Awaited<ReturnType<TopicModel['findById']>>>);
    vi.spyOn(threadModel, 'findById').mockResolvedValue({
      id: 'branch',
      topicId: 'source-topic',
      metadata: { heteroSessionId: 'child-native' },
    } as NonNullable<Awaited<ReturnType<ThreadModel['findById']>>>);
    const service = new HeterogeneousAgentService(db, 'test-user', {
      snapshotStore: null,
      threadModel,
      topicModel,
    });
    /** @example child-native is selected; source-native remains untouched. */
    expect(await service.getHeterogeneousResumeSessionId('source-topic', 'branch')).toBe(
      'child-native',
    );
    /** @example The parent binding cannot influence branch selection. */
    expect(topicRead).not.toHaveBeenCalled();
  });

  /** @example A first child turn has no resume binding until native Fork succeeds. */
  it('leaves an unstarted child unbound instead of using the source session', async () => {
    const db = {} as LobeChatDatabase;
    const topicModel = new TopicModel(db, 'test-user');
    const threadModel = new ThreadModel(db, 'test-user');
    vi.spyOn(topicModel, 'findById').mockResolvedValue({
      id: 'source-topic',
      metadata: { heteroSessionId: 'source-native' },
    } as NonNullable<Awaited<ReturnType<TopicModel['findById']>>>);
    vi.spyOn(threadModel, 'findById').mockResolvedValue({
      id: 'branch',
      topicId: 'source-topic',
      metadata: {},
    } as NonNullable<Awaited<ReturnType<ThreadModel['findById']>>>);
    const service = new HeterogeneousAgentService(db, 'test-user', {
      snapshotStore: null,
      threadModel,
      topicModel,
    });
    /** @example An unbound branch is resolved by its immutable Fork origin later. */
    expect(await service.getHeterogeneousResumeSessionId('source-topic', 'branch')).toBeUndefined();
  });

  /** @example A thread from another topic cannot be used to read native history. */
  it('rejects a thread outside the requested topic', async () => {
    const db = {} as LobeChatDatabase;
    const topicModel = new TopicModel(db, 'test-user');
    const threadModel = new ThreadModel(db, 'test-user');
    vi.spyOn(topicModel, 'findById').mockResolvedValue(undefined);
    vi.spyOn(threadModel, 'findById').mockResolvedValue({
      id: 'branch',
      topicId: 'different-topic',
      metadata: { heteroSessionId: 'other-native' },
    } as NonNullable<Awaited<ReturnType<ThreadModel['findById']>>>);
    const service = new HeterogeneousAgentService(db, 'test-user', {
      snapshotStore: null,
      threadModel,
      topicModel,
    });
    /** @example Scope mismatch is a terminal dispatch error. */
    await expect(service.getHeterogeneousResumeSessionId('source-topic', 'branch')).rejects.toThrow(
      'unavailable',
    );
  });
  /** @example Tool execution without assistant text still makes a branch used. */
  it('refuses to fork again when a tool-only answer has lost all child provenance', async () => {
    // ROOT CAUSE:
    // The server ancestry projection dropped tools even though the shared resolver
    // counts tool-only assistant rows as visible answers. With both durable child
    // bindings missing, that projection restarted an already-used branch.
    // Preserve the persisted tool calls so recovery fails closed instead.
    const recoveredSession = { id: '' };
    const db = {} as LobeChatDatabase;
    const messageModel = new MessageModel(db, 'test-user');
    const threadModel = new ThreadModel(db, 'test-user');
    const origin = { position: 'after' as const, threadId: 'source-native', turnId: 'source-turn' };
    vi.spyOn(threadModel, 'findById').mockResolvedValue({
      id: 'child-thread',
      topicId: 'source-topic',
      metadata: { codexForkTarget: origin },
    } as NonNullable<Awaited<ReturnType<ThreadModel['findById']>>>);
    vi.spyOn(messageModel, 'findById').mockImplementation(
      async (id) =>
        ({
          id,
          topicId: 'source-topic',
          threadId: 'child-thread',
          parentId: id === 'follow-up' ? 'tool-answer' : null,
          role: id === 'follow-up' ? 'user' : 'assistant',
          content: id === 'follow-up' ? 'Continue' : '',
          error: null,
          metadata:
            id === 'tool-answer' && recoveredSession.id
              ? { heteroSessionId: recoveredSession.id }
              : {},
          tools: id === 'tool-answer' ? [{ id: 'shell-call', type: 'shell' }] : null,
        }) as NonNullable<Awaited<ReturnType<MessageModel['findById']>>>,
    );
    const service = new HeterogeneousAgentService(db, 'test-user', {
      messageModel,
      threadModel,
      snapshotStore: null,
    });
    /** @example No source resume or Fork target escapes the lost-child guard. */
    expect(await service.getCodexBranchRun('source-topic', 'follow-up', 'child-thread')).toEqual({
      codexBranchError:
        'This Codex branch lost its native session. Fork again from the original message.',
    });
    recoveredSession.id = 'child-native';
    /** @example Restoring the child's own provenance recovers it without replaying tools. */
    expect(await service.getCodexBranchRun('source-topic', 'follow-up', 'child-thread')).toEqual({
      resumeSessionId: 'child-native',
    });
  });

  /** @example Finishing a continuation child cannot replace the source binding or assistant text. */
  it('keeps continuation completion and native binding inside the child', async () => {
    // ROOT CAUSE:
    // The former callback treated every thread as an isolation task and projected its answer
    // onto sourceMessageId. Fork uses continuation threads, whose source must remain unchanged.
    const db = {} as LobeChatDatabase;
    const messageModel = new MessageModel(db, 'test-user');
    const threadModel = new ThreadModel(db, 'test-user');
    const topicModel = new TopicModel(db, 'test-user');
    const agentOperationModel = new AgentOperationModel(db, 'test-user');
    const thread = {
      id: 'child-thread',
      topicId: 'source-topic',
      type: 'continuation',
      sourceMessageId: 'source-assistant',
      metadata: {},
    };
    vi.spyOn(threadModel, 'findById').mockResolvedValue(
      thread as NonNullable<Awaited<ReturnType<ThreadModel['findById']>>>,
    );
    const threadBinding = vi
      .spyOn(threadModel, 'updateMetadata')
      .mockResolvedValue({ id: 'child-thread' });
    const threadUpdate = vi.spyOn(threadModel, 'update').mockResolvedValue(undefined);
    const sourceBinding = vi.spyOn(topicModel, 'updateMetadata').mockResolvedValue(undefined);
    vi.spyOn(topicModel, 'settleRunningOperation').mockResolvedValue({
      status: 'settled',
      assistantMessageId: 'child-assistant',
      threadId: 'child-thread',
    } as Awaited<ReturnType<TopicModel['settleRunningOperation']>>);
    vi.spyOn(agentOperationModel, 'findById').mockResolvedValue({
      id: 'child-operation',
      threadId: 'child-thread',
      metadata: { assistantMessageId: 'child-assistant' },
    } as NonNullable<Awaited<ReturnType<AgentOperationModel['findById']>>>);
    vi.spyOn(messageModel, 'findById').mockResolvedValue({
      id: 'child-assistant',
      content: 'private child answer',
    } as NonNullable<Awaited<ReturnType<MessageModel['findById']>>>);
    const messageWrite = vi.spyOn(messageModel, 'update').mockResolvedValue({ success: true });
    vi.spyOn(HeterogeneousPersistenceHandler.prototype, 'finish').mockResolvedValue(undefined);
    vi.spyOn(CompletionLifecycle.prototype, 'completeOperation').mockResolvedValue(undefined);
    const service = new HeterogeneousAgentService(db, 'test-user', {
      agentOperationModel,
      messageModel,
      threadModel,
      topicModel,
      snapshotStore: null,
      streamEventManager: {
        publishStreamEvent: vi.fn(async () => 'event-id'),
      } as IStreamEventManager,
    });
    await service.heteroFinish({
      agentType: 'codex',
      operationId: 'child-operation',
      topicId: 'source-topic',
      result: 'error',
      sessionId: 'child-native',
    });
    /** @example Only the child's native session is updated on callback. */
    expect(threadBinding).toHaveBeenCalledWith('child-thread', { heteroSessionId: 'child-native' });
    /** @example The source native binding survives the child callback. */
    expect(sourceBinding).not.toHaveBeenCalled();
    /** @example A continuation cannot overwrite the original assistant answer. */
    expect(messageWrite.mock.calls.some(([id]) => id === 'source-assistant')).toBe(false);
    /** @example Continuations are not finalized as one-shot isolation tasks. */
    expect(threadUpdate).not.toHaveBeenCalled();
  });
});
