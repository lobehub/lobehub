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
    files: ['file-1'],
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
    vi.spyOn(threadService, 'updateThread').mockImplementation(async (id, value) => {
      threads = threads.map((thread) => (thread.id === id ? { ...thread, ...value } : thread));
      return { command: 'UPDATE', fields: [], oid: 0, rowCount: 1, rows: [] };
    });
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
      return { messageId: 'forked-user', threadId: 'branch' };
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

  /** @example A user-message Fork on a connected device dispatches the new child through the server. */
  it('automatically resends a device user fork through the gateway', async () => {
    vi.mocked(dispatcher.selectRuntimeType).mockReturnValue('gateway');
    const dispatch = vi.spyOn(useChatStore.getState(), 'executeGatewayAgent').mockResolvedValue();
    const store = createStore({ context, initialMessages: [source] });
    const original = structuredClone(source);
    await store.getState().forkCodexMessage(source.id);
    /** @example Only the replayed user row in the child is used as the run parent. */
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ topicId: 'topic', threadId: 'branch', scope: 'thread' }),
        fileIds: ['file-1'],
        message: source.content,
        parentMessageId: 'forked-user',
      }),
    );
    /** @example The device request cannot accidentally run through Electron IPC. */
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    /** @example Source message data remains unchanged. */
    expect(source).toEqual(original);
    /** @example Native user-before boundary is persisted for authenticated server dispatch. */
    expect(threads[0].metadata?.codexForkTarget).toEqual({
      position: 'before',
      threadId: 'native-source',
      turnId: 'turn-2',
    });
  });

  /** @example Assistant-after Fork creates a child but waits for its next user input. */
  it('creates a device assistant fork without replaying the assistant as a prompt', async () => {
    vi.mocked(dispatcher.selectRuntimeType).mockReturnValue('gateway');
    const dispatch = vi.spyOn(useChatStore.getState(), 'executeGatewayAgent').mockResolvedValue();
    const store = createStore({ context, initialMessages: [{ ...source, role: 'assistant' }] });
    await store.getState().forkCodexMessage(source.id);
    /** @example The exact after-turn boundary is saved on the new child. */
    expect(threadService.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          codexForkTarget: { position: 'after', threadId: 'native-source', turnId: 'turn-2' },
        }),
      }),
    );
    /** @example No unsolicited assistant replay or local native execution occurs. */
    expect(dispatch).not.toHaveBeenCalled();
    /** @example No Electron shortcut is used. */
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
  });

  it('runs the forked prompt in a separate branch while preserving the original', async () => {
    const store = createStore({ context, initialMessages: [source] });
    const original = structuredClone(store.getState().dbMessages);
    await store.getState().forkCodexMessage(source.id);
    expect(store.getState().dbMessages).toEqual(original);
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        context: expect.objectContaining({ topicId: 'topic', threadId: 'branch' }),
        codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-2' },
        userMessageId: 'forked-user',
        message: source.content,
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
  // A pre-turn failure has no codexTurnId. Requiring a new fork target there
  // prevented retries and ignored the origin boundary stored on the branch.
  /** @example Retry restarts a forked branch at its persisted native origin. */
  it('retries a forked prompt before its first native turn exists', async () => {
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
      id: 'forked-user',
      threadId: 'branch',
      metadata: {},
      content: 'Replayed',
    };
    const store = createStore({ context: branchContext, initialMessages: [pendingUser] });
    await store.getState().regenerateUserMessage(pendingUser.id);
    /** @example Retry preserves the pending branch boundary and replayed prompt. */
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        codexForkTarget: target,
        message: 'Replayed',
        resumeSessionId: 'native-source',
        context: expect.objectContaining({ threadId: 'branch' }),
      }),
    );
    /** @example Source topic session state is unchanged. */
    expect(useChatStore.getState().topicDetailMap.topic).toEqual(topic);
  });

  /** @example Retry uses durable child ancestry even while the branch binding still names its source. */
  it.each([false, true])(
    'recovers a child before retrying a follow-up (started=%s)',
    async (started) => {
      // ROOT CAUSE:
      // A failed binding save survived reload as the original source forkTarget.
      // Normal sends recovered the child, but Retry preferred that stale target.
      // Both paths must recover from the selected message's own branch ancestry.
      const target = { position: 'after' as const, threadId: 'native-source', turnId: 'turn-2' };
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
      const establishedChild = {
        ...source,
        id: 'child-answer',
        role: 'assistant' as const,
        threadId: 'branch',
        metadata: { codexTurnId: 'child-first-turn', heteroSessionId: 'native-child' },
        content: 'Only the child knows PRIVATE-CHILD',
      };
      const followUp = {
        ...source,
        id: 'follow-up',
        parentId: establishedChild.id,
        threadId: 'branch',
        content: 'Recall the private child value',
        metadata: started
          ? { codexTurnId: 'child-follow-up-turn', heteroSessionId: 'native-child' }
          : {},
      };
      const store = createStore({
        context: branchContext,
        initialMessages: [establishedChild, followUp],
      });
      await store.getState().regenerateUserMessage(followUp.id);
      /** @example An unstarted follow-up resumes the existing child; a started one forks its exact child boundary. */
      expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          resumeSessionId: 'native-child',
          codexForkTarget: started
            ? { position: 'before', threadId: 'native-child', turnId: 'child-follow-up-turn' }
            : undefined,
          message: followUp.content,
        }),
      );
      /** @example The source binding and history remain unchanged during recovery. */
      expect(useChatStore.getState().topicDetailMap.topic).toEqual(topic);
    },
  );

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
    const first = store.getState().forkCodexMessage(source.id);
    await vi.waitFor(() => {
      /** @example The first mutation has reached the service before a second click. */
      expect(threadService.createThreadWithMessage).toHaveBeenCalledTimes(1);
    });
    await expect(store.getState().forkCodexMessage(source.id)).rejects.toThrow();
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
    await expect(store.getState().forkCodexMessage(source.id)).rejects.toThrow(
      'database unavailable',
    );
    /** @example A failed save never dismisses the source conversation's unsaved draft. */
    expect(store.getState().dbMessages).toEqual(original);
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    await store.getState().forkCodexMessage(source.id);
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledTimes(1);
  });

  // ROOT CAUSE:
  // Deployed create schemas can strip newer native fork metadata. The old action
  // immediately reread that empty metadata, so Edit/Resend failed before execution;
  // assistant forks instead lost their boundary and could start fresh context.
  // Persist the child metadata through the existing update endpoint before handoff.
  /** @example A server with an older create schema still runs the replayed child. */
  it('persists forked branch metadata when the create endpoint strips new fields', async () => {
    const originalCreate = vi
      .mocked(threadService.createThreadWithMessage)
      .getMockImplementation()!;
    vi.mocked(threadService.createThreadWithMessage).mockImplementationOnce(async (params) => {
      const result = await originalCreate(params);
      threads[0].metadata = {};
      return result;
    });
    const store = createStore({ context, initialMessages: [source] });
    await store.getState().forkCodexMessage(source.id);
    /** @example The actual action resolves the saved source before launching the child. */
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        resumeSessionId: 'native-source',
        codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-2' },
      }),
    );
    /** @example The native origin and directory survive the server round trip. */
    expect(threads[0].metadata).toMatchObject({
      codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-2' },
      sourceMessageExcluded: true,
      workingDirectory: '/work',
    });
  });

  /** @example Fork-after retains its pending native boundary before the first child prompt. */
  it('persists assistant fork metadata when the create endpoint strips new fields', async () => {
    vi.mocked(threadService.createThread).mockImplementationOnce(async (params) => {
      threads.push({
        ...params,
        metadata: {},
        id: 'branch',
        title: 'Branch',
        status: ThreadStatus.Active,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastActiveAt: new Date(0),
        userId: 'user',
      });
      return 'branch';
    });
    const store = createStore({ context, initialMessages: [{ ...source, role: 'assistant' }] });
    await store.getState().forkCodexMessage(source.id);
    /** @example The saved origin cannot silently become a fresh conversation. */
    expect(threads[0].metadata).toMatchObject({
      codexForkTarget: { position: 'after', threadId: 'native-source', turnId: 'turn-2' },
    });
    /** @example The child cannot resume the source as if it were its own session. */
    expect(threads[0].metadata).not.toHaveProperty('heteroSessionId');
  });

  /** @example A failed metadata write keeps the source conversation open and never starts an unbound child. */
  it('does not hand off or execute a child when native metadata persistence fails', async () => {
    vi.mocked(threadService.updateThread).mockRejectedValueOnce(new Error('metadata write failed'));
    const store = createStore({ context, initialMessages: [source] });
    /** @example The caller receives the actual persistence error for its retained draft. */
    await expect(store.getState().forkCodexMessage(source.id)).rejects.toThrow(
      'metadata write failed',
    );
    /** @example A saved prompt is not enough to dismiss its source conversation. */
    /** @example No native process starts with missing fork provenance. */
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  // Switching a native conversation to API auth still selects the hetero runtime.
  // The action persisted a child before Desktop rejected its hosted provider binding.
  // Reject unsupported auth before either user or assistant thread creation.
  /** @example Existing native provenance cannot make an API-bound fork runnable. */
  it.each(['user', 'assistant'] as const)(
    'rejects API-bound %s forks before creating a child',
    async (role) => {
      vi.mocked(agentSelectors.getAgentConfigById).mockReturnValue(() => ({
        ...DEFAULT_AGENT_CONFIG,
        agencyConfig: {
          executionTarget: 'local',
          heterogeneousProvider: { type: 'codex', command: 'codex', authMode: 'api' },
        },
      }));
      const store = createStore({ context, initialMessages: [{ ...source, role }] });
      /** @example Validation precedes every branch write and native dispatch. */
      await expect(store.getState().forkCodexMessage(source.id)).rejects.toThrow('native Codex');
      expect(threadService.createThread).not.toHaveBeenCalled();
      expect(threadService.createThreadWithMessage).not.toHaveBeenCalled();
      expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    },
  );

  it('does not create a branch when the selected message has no native provenance', async () => {
    const store = createStore({ context, initialMessages: [{ ...source, metadata: {} }] });
    await expect(store.getState().forkCodexMessage(source.id)).rejects.toThrow(
      'no native Codex turn',
    );
    expect(threadService.createThreadWithMessage).not.toHaveBeenCalled();
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    expect(
      Object.values(useChatStore.getState().operations).some((op) => op.status === 'running'),
    ).toBe(false);
  });
});
