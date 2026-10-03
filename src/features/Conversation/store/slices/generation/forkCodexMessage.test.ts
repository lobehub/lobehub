import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { type ChatTopic, type ThreadItem, ThreadStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { threadService } from '@/services/thread';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import * as dispatcher from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import * as executor from '@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor';

import { createStore } from '../../index';

describe('forkCodexMessage', () => {
  const topic: ChatTopic = {
    id: 'topic',
    title: 'Original',
    createdAt: 0,
    updatedAt: 0,
    metadata: {
      workingDirectory: '/work',
      heteroSessionId: 'native-source',
      heteroSessionBindingKey: 'native:v1:codex',
    },
  };
  const context = { agentId: 'agent', topicId: 'topic', threadId: null };
  const source = {
    id: 'original',
    content: 'Original prompt',
    role: 'user' as const,
    createdAt: 0,
    updatedAt: 0,
    metadata: {
      codexTurnId: 'turn-2',
      heteroSessionId: 'native-source',
      pageSelections: [{ id: 'page-selection', pageId: 'page-1', content: 'Selected paragraph' }],
      contextSelections: [
        {
          id: 'selection',
          content: 'const answer = 42;',
          source: 'code' as const,
          filePath: 'example.ts',
          lineRange: { startLine: 7, endLine: 7 },
        },
      ],
    },
  };
  let threads: ThreadItem[];
  beforeEach(() => {
    threads = [];
    useChatStore.setState(useChatStore.getInitialState(), true);
    useChatStore.setState({
      activeAgentId: 'agent',
      activeTopicId: 'topic',
      topicDetailMap: { topic },
    });
    vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(() => ({
      ...DEFAULT_AGENT_CONFIG,
      agencyConfig: {
        executionTarget: 'local',
        heterogeneousProvider: { type: 'codex', command: 'codex' },
      },
    }));
    vi.spyOn(dispatcher, 'selectRuntimeType').mockReturnValue('hetero');
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue();
    vi.spyOn(threadService, 'getThreads').mockImplementation(async () => threads);
    vi.spyOn(threadService, 'createThreadWithMessage').mockImplementation(async (params) => {
      threads.push({
        ...params,
        id: 'branch',
        title: 'Branch',
        status: ThreadStatus.Active,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastActiveAt: new Date(0),
        userId: 'user',
      });
      return { messageId: 'edited-user', threadId: 'branch' };
    });
    vi.spyOn(threadService, 'createThread').mockResolvedValue('branch');
    vi.spyOn(messageService, 'createMessage').mockResolvedValue({
      id: 'new-assistant',
      messages: [],
    });
    vi.spyOn(executor, 'executeHeterogeneousAgent').mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState(useChatStore.getInitialState(), true);
  });

  it('runs the edited prompt in a separate branch while preserving the original', async () => {
    const store = createStore({ context, initialMessages: [source] });
    const original = structuredClone(store.getState().dbMessages);
    await store.getState().forkCodexMessage(source.id, { content: 'Corrected prompt' });
    expect(store.getState().dbMessages).toEqual(original);
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        context: expect.objectContaining({ topicId: 'topic', threadId: 'branch' }),
        codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-2' },
        userMessageId: 'edited-user',
        message: 'Corrected prompt',
        contextSelections: source.metadata.contextSelections,
        pageSelections: source.metadata.pageSelections,
      }),
    );
    expect(useChatStore.getState().portalThreadId).toBe('branch');
    expect(useChatStore.getState().topicDetailMap.topic).toEqual(topic);
    expect(
      Object.values(useChatStore.getState().operations).some(
        (op) => op.type === 'regenerate' && op.status === 'running',
      ),
    ).toBe(false);
  });

  // ROOT CAUSE:
  // The editor awaited this action until native completion, covering approvals.
  // Notify it after the persisted child is loaded, before awaiting its execution.
  /** @example A persisted child is ready for interaction during native approval. */
  it('hands off the persisted branch before native execution settles', async () => {
    let finish!: () => void;
    const pendingRun = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(executor.executeHeterogeneousAgent).mockImplementation(async () => pendingRun);
    const store = createStore({ context, initialMessages: [source] });
    const onBranchReady = vi.fn();
    const submission = store
      .getState()
      .forkCodexMessage(source.id, { content: 'Revised' }, onBranchReady);
    try {
      await vi.waitFor(() => {
        /** @example Native execution is pending, so no final response is required. */
        expect(executor.executeHeterogeneousAgent).toHaveBeenCalledTimes(1);
      });
      /** @example The child exists and is loaded before the editor may dismiss. */
      expect(useChatStore.getState().portalThreadId).toBe('branch');
      /** @example The editor can expose an approval before the run resolves. */
      expect(onBranchReady).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await submission;
    }
  });

  // ROOT CAUSE:
  // A pre-turn failure has no codexTurnId. Requiring a new fork target there
  // prevented retries and ignored the pending boundary stored on the branch.
  /** @example Retry restarts an edited branch at its persisted native boundary. */
  it('retries an edited prompt before its first native turn exists', async () => {
    const target = { position: 'before' as const, threadId: 'native-source', turnId: 'turn-2' };
    const branchContext = { ...context, scope: 'thread' as const, threadId: 'branch' };
    useChatStore.setState({
      threadMaps: {
        topic: [
          {
            id: 'branch',
            topicId: 'topic',
            type: 'continuation',
            metadata: { ...topic.metadata, codexForkTarget: target },
          } as ThreadItem,
        ],
      },
    });
    vi.spyOn(useChatStore.getState(), 'switchMessageBranch').mockResolvedValue();
    const pendingUser = {
      ...source,
      id: 'edited-user',
      threadId: 'branch',
      metadata: {},
      content: 'Revised',
    };
    const store = createStore({ context: branchContext, initialMessages: [pendingUser] });
    await store.getState().regenerateUserMessage(pendingUser.id);
    /** @example Retry preserves the pending branch boundary and revised prompt. */
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        codexForkTarget: target,
        message: 'Revised',
        resumeSessionId: 'native-source',
        context: expect.objectContaining({ threadId: 'branch' }),
      }),
    );
    /** @example Source topic session state is unchanged. */
    expect(useChatStore.getState().topicDetailMap.topic).toEqual(topic);
  });

  /** @example A double submit creates one child and leaves a newly selected topic alone. */
  it('isolates navigation and duplicate submissions while branch creation is pending', async () => {
    const originalCreate = vi
      .mocked(threadService.createThreadWithMessage)
      .getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(threadService.createThreadWithMessage).mockImplementation(async (params) => {
      await pending;
      return originalCreate(params);
    });
    const store = createStore({ context, initialMessages: [source] });
    const first = store.getState().forkCodexMessage(source.id, { content: 'Revised' });
    await vi.waitFor(() => {
      /** @example The first mutation has reached the service before a second click. */
      expect(threadService.createThreadWithMessage).toHaveBeenCalledTimes(1);
    });
    await expect(
      store.getState().forkCodexMessage(source.id, { content: 'Duplicate' }),
    ).rejects.toThrow();
    useChatStore.setState({ activeTopicId: 'other-topic', portalThreadId: 'other-thread' });
    release();
    await first;
    /** @example Only one persisted child and one native run are created. */
    expect(threadService.createThreadWithMessage).toHaveBeenCalledTimes(1);
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledTimes(1);
    /** @example Completing in the background cannot navigate the new topic's portal. */
    expect(useChatStore.getState().portalThreadId).toBe('other-thread');
    expect(useChatStore.getState().activeTopicId).toBe('other-topic');
  });

  /** @example A database failure preserves source history and releases the operation for retry. */
  it('can retry branch creation after a persistence failure', async () => {
    vi.mocked(threadService.createThreadWithMessage).mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    const store = createStore({ context, initialMessages: [source] });
    const original = structuredClone(store.getState().dbMessages);
    const onBranchReady = vi.fn();
    await expect(
      store.getState().forkCodexMessage(source.id, { content: 'Revised' }, onBranchReady),
    ).rejects.toThrow('database unavailable');
    /** @example A failed save never dismisses the editor's unsaved draft. */
    expect(onBranchReady).not.toHaveBeenCalled();
    expect(store.getState().dbMessages).toEqual(original);
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    await store.getState().forkCodexMessage(source.id, { content: 'Revised' });
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledTimes(1);
  });

  it('does not create a branch when the selected message has no native provenance', async () => {
    const store = createStore({ context, initialMessages: [{ ...source, metadata: {} }] });
    await expect(
      store.getState().forkCodexMessage(source.id, { content: 'edited' }),
    ).rejects.toThrow('no native Codex turn');
    expect(threadService.createThreadWithMessage).not.toHaveBeenCalled();
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    expect(
      Object.values(useChatStore.getState().operations).some((op) => op.status === 'running'),
    ).toBe(false);
  });
});
