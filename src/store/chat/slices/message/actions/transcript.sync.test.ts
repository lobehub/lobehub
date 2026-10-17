import type { UIChatMessage } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';
import {
  clearMessageListClientCacheState,
  MESSAGE_LIST_VERIFICATION_INTERVAL,
  runMessageListQuery,
} from '@/services/message/cache';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';

import { resetTranscripts, rowsOf, seedRows, syncMessages } from './testUtils';

vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => ({
    flatList: [...messages].sort((a, b) => a.createdAt - b.createdAt),
    messageMap: Object.fromEntries(messages.map((m) => [m.id, m])),
  }),
}));

vi.mock('@/services/message', () => {
  const getMessages = vi.fn();
  return {
    messageService: {
      getEarlierMessages: vi.fn(),
      // The list cache reads pages; tests stub the plain list underneath.
      getMessageListPage: vi.fn((params) => getMessages(params)),
      getMessages,
    },
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

// Simulate SWR for testing: fetch once, report success.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn((key, fetcher, options) => {
    if (key) fetcher?.().then((data: unknown) => options?.onSuccess?.(data));
    return { data: undefined, isValidating: true, mutate: vi.fn() };
  }),
}));

/** The transcript sync's SWR keys (the replica's hydration read is a separate query). */
const messageSyncKeys = () =>
  vi
    .mocked(useClientDataSWR)
    .mock.calls.map(([key]) => key as any[] | null)
    .filter((key) => key?.[0] === 'message:list');

const context = { agentId: 'test-session', threadId: null, topicId: 'test-topic' };

describe('useFetchMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    clearMessageListClientCacheState();
    resetTranscripts();
  });

  it.each(['approved', 'rejected', 'aborted'] as const)(
    'observes a remote %s while preserving locally streaming content',
    async (status) => {
      vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
      const pending: UIChatMessage = {
        content: '',
        createdAt: 1,
        id: 'question',
        role: 'tool',
        tool_call_id: 'call-1',
        updatedAt: 10,
        pluginIntervention: { status: 'pending' },
      };
      const streaming: UIChatMessage = {
        content: 'Streaming content that has not been persisted yet',
        createdAt: 2,
        id: 'assistant',
        role: 'assistant',
        updatedAt: 10,
      };
      const answered: UIChatMessage = {
        ...pending,
        content: 'Remote answer',
        updatedAt: 1,
        pluginIntervention: { status },
      };
      seedRows(context, [pending, streaming]);
      vi.mocked(messageService.getMessages).mockResolvedValue([
        answered,
        { ...streaming, content: '...' },
      ]);

      syncMessages(context, { refreshInterval: 2000 });

      await waitFor(() => expect(rowsOf(context)?.[0]).toEqual(answered));
      expect(rowsOf(context)?.[1]).toBe(streaming);
      expect(useClientDataSWR).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function),
        // Polling runs on the hook's own timer (see transcript.approvalSync).
        expect.objectContaining({
          dedupingInterval: 1000,
          refreshWhenHidden: false,
          refreshWhenOffline: false,
        }),
      );
    },
  );

  it('settles a remote answer and permits an authoritative rollback at the same timestamp', async () => {
    const pending: UIChatMessage = {
      content: '',
      createdAt: 1,
      id: 'question',
      role: 'tool',
      tool_call_id: 'call-1',
      updatedAt: 10,
      pluginIntervention: { status: 'pending' },
    };
    const answered: UIChatMessage = {
      ...pending,
      content: 'Remote answer',
      updatedAt: 1,
      pluginIntervention: { status: 'approved' },
    };
    seedRows(context, [pending]);
    vi.mocked(messageService.getMessages).mockResolvedValue([answered]);
    syncMessages(context);
    await waitFor(() => expect(rowsOf(context)).toEqual([answered]));

    clearMessageListClientCacheState();
    const rollback = { ...pending, updatedAt: 1 };
    vi.mocked(messageService.getMessages).mockResolvedValue([rollback]);
    syncMessages(context);
    await waitFor(() => expect(rowsOf(context)).toEqual([rollback]));
  });

  it('passes threadId to the message read', async () => {
    vi.mocked(messageService.getMessages).mockResolvedValue([]);

    syncMessages({ ...context, threadId: 'test-thread' });

    await waitFor(() => {
      expect(messageService.getMessages).toHaveBeenCalledWith({
        agentId: 'test-session',
        groupId: null,
        projectToolPayloads: false,
        threadId: 'test-thread',
        topicId: 'test-topic',
      });
    });
  });

  it('lands fetched rows in the conversation bucket', async () => {
    const fetched: UIChatMessage[] = [
      { id: 'sync-msg-1', content: 'Synced', role: 'user', createdAt: 1000, updatedAt: 1000 },
    ];
    vi.mocked(messageService.getMessages).mockResolvedValue(fetched);

    const result = syncMessages(context);

    expect(result.isLoading).toBe(true);
    await waitFor(() => expect(rowsOf(context)).toEqual(fetched));
  });

  describe('while an agent run is in flight in this conversation', () => {
    const fetched: UIChatMessage[] = [
      { content: 'Run the script', createdAt: 1000, id: 'msg-user', role: 'user', updatedAt: 1000 },
    ];

    it('still lands the first load, so a parked run does not leave a skeleton (G-05)', async () => {
      // A group supervisor parked on a member's approval stays `running`
      // indefinitely; dropping the first load there never initializes the list.
      vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
      vi.mocked(messageService.getMessages).mockResolvedValue(fetched);

      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)?.map((m) => m.id)).toEqual(['msg-user']));
    });

    it('keeps loaded rows but lands rows the list has never seen (G-05)', async () => {
      // A stale cached first load can miss the parked member's rows; the fresh
      // read that follows must still bring them in, without touching the
      // rows the stream owns.
      vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
      const streamed = {
        content: 'streamed so far',
        createdAt: 2000,
        id: 'msg-supervisor',
        role: 'assistant',
        updatedAt: 2000,
      } as UIChatMessage;
      const memberTool = {
        content: '',
        createdAt: 3000,
        id: 'msg-member-tool',
        role: 'tool',
        updatedAt: 3000,
      } as UIChatMessage;
      vi.mocked(messageService.getMessages).mockResolvedValue([
        ...fetched,
        { ...streamed, content: '' },
        memberTool,
      ]);
      seedRows(context, [...fetched, streamed]);

      syncMessages(context);

      await waitFor(() => {
        expect(rowsOf(context)?.map((m) => m.id)).toContain('msg-member-tool');
      });
      expect(rowsOf(context)?.find((m) => m.id === 'msg-supervisor')?.content).toBe(
        'streamed so far',
      );
    });

    it('drops a refetch that brings nothing new', async () => {
      vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
      vi.mocked(messageService.getMessages).mockResolvedValue(fetched);
      const loaded = [{ ...fetched[0], content: 'local' }];
      seedRows(context, loaded);

      syncMessages(context);

      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rowsOf(context)).toBe(loaded);
    });
  });

  it('lands a result that resolves after a switch in its own conversation only', async () => {
    let resolveFetch!: (messages: UIChatMessage[]) => void;
    vi.mocked(messageService.getMessages).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const oldContext = { ...context, topicId: 'topic-old' };
    const currentContext = { ...context, topicId: 'topic-current' };
    const currentMessages: UIChatMessage[] = [
      {
        content: 'current topic',
        createdAt: 2000,
        id: 'msg-current',
        role: 'user',
        updatedAt: 2000,
      },
    ];
    const late: UIChatMessage = {
      content: 'late old topic result',
      createdAt: 1000,
      id: 'msg-old',
      role: 'assistant',
      updatedAt: 1000,
    };

    syncMessages(oldContext);
    seedRows(currentContext, currentMessages);
    await act(async () => {
      resolveFetch([late]);
      await Promise.resolve();
    });

    await waitFor(() => expect(rowsOf(oldContext)).toEqual([late]));
    expect(rowsOf(currentContext)).toBe(currentMessages);
  });

  it.each([
    ['an empty agent id', { agentId: '', threadId: null, topicId: null }],
    ['a null topic id (new conversation state)', { ...context, topicId: null }],
    ['an undefined topic id (new conversation state)', { ...context, topicId: undefined as any }],
  ])('does not fetch with %s', (_, target) => {
    syncMessages(target);

    // A null key disables the read, so local optimistic rows are not overwritten.
    expect(vi.mocked(useClientDataSWR)).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      expect.any(Object),
    );
    expect(messageService.getMessages).not.toHaveBeenCalled();
  });

  it('keys the sync by the canonical read context', () => {
    // The SWR mock runs the fetcher; an unmocked list read rejects after the test.
    vi.mocked(messageService.getMessages).mockResolvedValue([]);

    syncMessages({ ...context, threadId: 'thread-1' });
    syncMessages({ ...context, threadId: 'thread-2' });

    const [first, second] = messageSyncKeys();
    expect(first).not.toEqual(second);
    expect(first![0]).toBe('message:list');
    expect(first![1]).toEqual({
      agentId: 'test-session',
      groupId: null,
      threadId: 'thread-1',
      topicId: 'test-topic',
    });
    expect((second as any[])[1].threadId).toBe('thread-2');
  });

  it('skips switch-time revalidation after a successful server verification', async () => {
    await runMessageListQuery(context, async () => []);
    vi.mocked(messageService.getMessages).mockResolvedValue([]);

    syncMessages(context);

    expect(vi.mocked(useClientDataSWR)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Function),
      expect.objectContaining({
        dedupingInterval: MESSAGE_LIST_VERIFICATION_INTERVAL,
        revalidateIfStale: false,
      }),
    );
  });

  it('passes groupId to the message read for group chat', async () => {
    vi.mocked(messageService.getMessages).mockResolvedValue([]);

    syncMessages({ ...context, agentId: 'supervisor-agent', groupId: 'group-123' });

    await waitFor(() => {
      expect(messageService.getMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'supervisor-agent',
          groupId: 'group-123',
          topicId: 'test-topic',
        }),
      );
    });
  });

  describe('merging a fetch into local rows', () => {
    const localVoice = (overrides: Partial<UIChatMessage>): UIChatMessage => ({
      audioList: [{ alt: 'voice.webm', id: 'tmp-audio', url: 'blob:voice-preview' }],
      content: '',
      createdAt: 2000,
      id: 'tmp-voice-message',
      metadata: { scope: LOCAL_MESSAGE_SCOPE },
      role: 'user',
      updatedAt: 2000,
      ...overrides,
    });

    it('preserves newer local message state when fetched data is stale', async () => {
      const localError = {
        body: { message: 'Codex CLI was not found' },
        message: 'Codex CLI was not found',
        type: 'AgentRuntimeError',
      } as any;
      vi.mocked(messageService.getMessages).mockResolvedValue([
        { id: 'msg-1', content: '', role: 'assistant', createdAt: 1000, updatedAt: 1000 },
      ]);
      seedRows(context, [
        {
          id: 'msg-1',
          content: '',
          error: localError,
          role: 'assistant',
          createdAt: 1000,
          updatedAt: 2000,
        },
      ]);

      syncMessages(context);

      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rowsOf(context)?.[0].error).toEqual(localError);
      expect(rowsOf(context)?.[0].updatedAt).toBe(2000);
    });

    it('accepts fetched message state when server data is newer', async () => {
      const persistedError = {
        body: { message: 'Persisted error' },
        message: 'Persisted error',
        type: 'AgentRuntimeError',
      } as any;
      vi.mocked(messageService.getMessages).mockResolvedValue([
        {
          id: 'msg-1',
          content: '',
          error: persistedError,
          role: 'assistant',
          createdAt: 1000,
          updatedAt: 3000,
        },
      ]);
      seedRows(context, [
        { id: 'msg-1', content: '', role: 'assistant', createdAt: 1000, updatedAt: 2000 },
      ]);

      syncMessages(context);

      await waitFor(() => {
        expect(rowsOf(context)?.[0].error).toEqual(persistedError);
        expect(rowsOf(context)?.[0].updatedAt).toBe(3000);
      });
    });

    it('preserves a local-only voice row that is missing from fetched data', async () => {
      const persisted: UIChatMessage = {
        id: 'persisted-message',
        content: 'Persisted message',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const voice = localVoice({});
      vi.mocked(messageService.getMessages).mockResolvedValue([persisted]);
      seedRows(context, [voice]);
      useChatStore.setState({
        voiceMessageUploadMap: { [voice.id]: { progress: 50, status: 'uploading' } },
      });

      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)).toEqual([persisted, voice]));
    });

    it('keeps an earlier local-only voice row ahead of a later fetched message', async () => {
      const voice = localVoice({ createdAt: 1000, updatedAt: 1000 });
      const later: UIChatMessage = {
        id: 'later-message',
        content: 'Later text',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      vi.mocked(messageService.getMessages).mockResolvedValue([later]);
      seedRows(context, [voice]);
      useChatStore.setState({
        voiceMessageUploadMap: { [voice.id]: { progress: 50, status: 'uploading' } },
      });

      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)).toEqual([voice, later]));
    });

    it('drops a missing local-only message after its voice transaction settles', async () => {
      const persisted: UIChatMessage = {
        id: 'persisted-message',
        content: 'Persisted message',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      vi.mocked(messageService.getMessages).mockResolvedValue([persisted]);
      seedRows(context, [localVoice({ id: 'tmp-settled-voice-message' })]);

      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)).toEqual([persisted]));
    });

    it('lets a fetched server row replace a newer local-only row with the same id', async () => {
      const fetched: UIChatMessage = {
        id: 'tmp-voice-message',
        audioList: [
          { alt: 'voice.webm', id: 'persisted-audio', url: 'https://example.com/voice.webm' },
        ],
        content: 'Persisted message',
        role: 'user',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const voice = localVoice({ createdAt: 1000, updatedAt: 2000 });
      vi.mocked(messageService.getMessages).mockResolvedValue([fetched]);
      seedRows(context, [voice]);
      useChatStore.setState({
        voiceMessageUploadMap: { [voice.id]: { progress: 100, status: 'sending' } },
      });

      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)).toEqual([fetched]));
    });

    it('keeps optimistic send rows when a stale fetch resolves before the server run starts', async () => {
      const previousReply: UIChatMessage = {
        id: 'previous-reply',
        content: 'Previous reply',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const optimisticUser: UIChatMessage = {
        id: 'msg_user',
        content: 'Follow-up question',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      const optimisticAssistant: UIChatMessage = {
        id: 'msg_assistant',
        content: '...',
        role: 'assistant',
        createdAt: 2001,
        updatedAt: 2001,
      };
      // The fetch was issued before the server persisted the new rows.
      vi.mocked(messageService.getMessages).mockResolvedValue([
        { ...previousReply, content: 'Previous reply (fetched)', updatedAt: 1500 },
      ]);
      seedRows(context, [previousReply, optimisticUser, optimisticAssistant]);

      // `sendMessage` is still waiting for `execAgentTask`; no runtime operation exists yet.
      const { operationId } = useChatStore.getState().startOperation({
        context: { ...context, messageId: optimisticUser.id },
        type: 'sendMessage',
      });
      useChatStore.getState().associateMessageWithOperation(optimisticUser.id, operationId);
      useChatStore.getState().associateMessageWithOperation(optimisticAssistant.id, operationId);

      try {
        syncMessages(context);

        await waitFor(() => expect(rowsOf(context)?.[0].content).toBe('Previous reply (fetched)'));
        expect(rowsOf(context)?.map((message) => message.id)).toEqual([
          previousReply.id,
          optimisticUser.id,
          optimisticAssistant.id,
        ]);
      } finally {
        useChatStore.getState().completeOperation(operationId);
      }
    });

    it('keeps a send whose stale fetch resolves after the send operation handed off', async () => {
      const previousReply: UIChatMessage = {
        id: 'previous-reply',
        content: 'Previous reply',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const sentUser: UIChatMessage = {
        id: 'msg_user',
        content: 'Follow-up question',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      const sentAssistant: UIChatMessage = {
        id: 'msg_assistant',
        content: '...',
        role: 'assistant',
        createdAt: 2001,
        updatedAt: 2001,
      };

      // The topic's read is still in flight from before the send.
      let resolveFetch!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages).mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as Promise<UIChatMessage[]>,
      );

      // The conversation was opened with the previous turn already on screen.
      seedRows(context, [previousReply]);
      syncMessages(context);

      // The send persists its pair and hands off to the runtime operation, so
      // no `sendMessage` operation is running when the stale read resolves.
      const { operationId } = useChatStore.getState().startOperation({
        context: { ...context, messageId: sentUser.id },
        type: 'sendMessage',
      });
      useChatStore.getState().associateMessageWithOperation(sentUser.id, operationId);
      useChatStore.getState().associateMessageWithOperation(sentAssistant.id, operationId);
      useChatStore
        .getState()
        .replaceMessages([previousReply, sentUser, sentAssistant], { context });
      useChatStore.getState().completeOperation(operationId);

      resolveFetch([{ ...previousReply, content: 'Previous reply (fetched)', updatedAt: 1500 }]);

      await waitFor(() => expect(rowsOf(context)?.[0].content).toBe('Previous reply (fetched)'));
      expect(rowsOf(context)?.map((message) => message.id)).toEqual([
        previousReply.id,
        sentUser.id,
        sentAssistant.id,
      ]);
    });
  });
});
