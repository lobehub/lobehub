import { type UIChatMessage } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { unstable_serialize } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REPLICA_INDEX_KEY } from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { CACHE_TIERS } from '@/libs/swr/localStorageProvider';
import { messageService } from '@/services/message';
import {
  clearMessageListClientCacheState,
  invalidateMessageListClientState,
  MESSAGE_LIST_VERIFICATION_INTERVAL,
  runMessageListQuery,
} from '@/services/message/cache';
import {
  conversationMessagesKey,
  conversationMessagesResource,
  transcriptOf,
} from '@/services/message/replica';
import { topicService } from '@/services/topic';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { getMessageTranscript } from '@/store/chat/slices/message/transcript';
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

vi.mock('@/services/topic', () => ({ topicService: { getTopicDetail: vi.fn() } }));

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
    .filter((key) => key?.[0] === 'replica:sync' && key[1] === 'conversationMessages');

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

  it('keys the sync by its entry, outside the SWR persistence tier', () => {
    // The SWR mock runs the fetcher; an unmocked list read rejects after the test.
    vi.mocked(messageService.getMessages).mockResolvedValue([]);
    const shared = { ...context, topicShareId: 'share-1' };

    syncMessages({ ...context, threadId: 'thread-1' });
    syncMessages({ ...context, threadId: 'thread-2' });
    syncMessages(shared);

    const keys = messageSyncKeys();
    expect(keys).toHaveLength(3);
    const [first, second, third] = keys;
    expect(first).not.toEqual(second);
    expect(first![4]).toBe(conversationMessagesKey({ ...context, threadId: 'thread-1' }));
    expect(second![4]).toBe(conversationMessagesKey({ ...context, threadId: 'thread-2' }));
    expect(third![4]).toBe(conversationMessagesKey(shared));
    // The replica persists transcripts itself; a key the SWR cache provider
    // persists would store each one (memory-only shares too) a second time.
    const persistedPatterns = [...CACHE_TIERS.idb, ...CACHE_TIERS.local];
    for (const key of keys) {
      const serialized = unstable_serialize(key);
      expect(persistedPatterns.filter((pattern) => serialized.includes(pattern))).toEqual([]);
    }
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

    it('keeps optimistic rows that were already present when the read started', async () => {
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

      // The server has not persisted the optimistic pair when a poll or focus
      // read starts, so its snapshot omits them even though they exist locally.
      vi.mocked(messageService.getMessages).mockResolvedValue([
        { ...previousReply, content: 'Previous reply (fetched)', updatedAt: 1500 },
      ]);
      seedRows(context, [previousReply]);
      for (const message of [sentUser, sentAssistant]) {
        useChatStore
          .getState()
          .internal_dispatchMessage(
            { id: message.id, type: 'createMessage', value: message as any },
            { conversationContext: context },
            { creationOrigin: 'client' },
          );
      }

      syncMessages(context);

      // Wait for the fetched row to land, so the merge has run.
      await waitFor(() => expect(rowsOf(context)?.[0].content).toBe('Previous reply (fetched)'));
      expect(rowsOf(context)?.map((message) => message.id)).toEqual([
        previousReply.id,
        sentUser.id,
        sentAssistant.id,
      ]);
    });

    it('drops a client row after a server replacement confirms it', async () => {
      const sent: UIChatMessage = {
        id: 'msg_user',
        content: 'Sent',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };

      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: sent.id, type: 'createMessage', value: sent as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );
      // The server returns the exact list already in memory: the replacement
      // is unchanged, but it still confirms the optimistic row.
      const stored = rowsOf(context)!;
      useChatStore.getState().replaceMessages(stored, { context });

      // A later snapshot omits it (deleted on another device).
      vi.mocked(messageService.getMessages).mockResolvedValue([]);
      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)).toEqual([]));
    });

    it('does not preserve a server-created row omitted by a later read', async () => {
      const serverShell: UIChatMessage = {
        id: 'msg_server_shell',
        content: '',
        role: 'assistant',
        createdAt: 2000,
        updatedAt: 2000,
      };
      // The gateway inserts a shell the server already created.
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: serverShell.id, type: 'createMessage', value: serverShell as any },
          { conversationContext: context },
          { creationOrigin: 'server' },
        );

      vi.mocked(messageService.getMessages).mockResolvedValue([]);
      syncMessages(context);

      await waitFor(() => expect(rowsOf(context)).toEqual([]));
    });

    it('forgets a temporary id once a server replacement remaps it', () => {
      const temp: UIChatMessage = {
        id: 'tmp_client',
        content: 'Sent',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: temp.id, type: 'createMessage', value: temp as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );
      const transcript = getMessageTranscript(useChatStore.setState, useChatStore.getState);
      expect(transcript.debugUnconfirmedClientIds()).toContain('tmp_client');

      useChatStore.getState().replaceMessages([{ ...temp, id: 'msg_server' }], { context });

      expect(transcript.debugUnconfirmedClientIds()).not.toContain('tmp_client');
    });

    it('lets the forced reread drop a row confirmed while awaiting the topic decision', async () => {
      const question: UIChatMessage = {
        id: 'question',
        content: '',
        role: 'tool',
        tool_call_id: 'call-1',
        createdAt: 1,
        updatedAt: 1,
        pluginIntervention: { status: 'pending' },
      };
      const answered: UIChatMessage = { ...question, pluginIntervention: { status: 'approved' } };
      const temp: UIChatMessage = {
        id: 'tmp_client',
        content: 'Sent',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      const serverRow: UIChatMessage = { ...temp, id: 'msg_server' };

      let calls = 0;
      vi.mocked(messageService.getMessages).mockImplementation(() => {
        calls += 1;
        // The forced read is the second call; later reads stay in flight so
        // they cannot repair the row for the assertion.
        if (calls === 1) return Promise.resolve([answered]);
        if (calls === 2) return Promise.resolve([]);
        return new Promise(() => {});
      });

      let resolveTopic!: () => void;
      vi.mocked(topicService.getTopicDetail).mockReturnValue(
        new Promise((resolve) => {
          resolveTopic = () => resolve(null);
        }) as ReturnType<typeof topicService.getTopicDetail>,
      );

      seedRows(context, [question]);
      syncMessages(context, { syncInterventions: true });
      await waitFor(() => expect(topicService.getTopicDetail).toHaveBeenCalled());

      // The optimistic row is confirmed and remapped while the fetch is
      // waiting, so the forced read that starts afterwards can know it.
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: temp.id, type: 'createMessage', value: temp as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );
      useChatStore.getState().replaceMessages([serverRow], { context });

      await act(async () => {
        resolveTopic();
      });

      // The forced read omits the row (deleted remotely); it is authoritative.
      await waitFor(() => expect(rowsOf(context)).toEqual([]));
    });

    it('keeps a client row when two fetches share a result across the topic wait', async () => {
      const question: UIChatMessage = {
        id: 'question',
        content: '',
        role: 'tool',
        tool_call_id: 'call-1',
        createdAt: 1,
        updatedAt: 1,
        pluginIntervention: { status: 'pending' },
      };
      const answered: UIChatMessage = { ...question, pluginIntervention: { status: 'approved' } };
      const sent: UIChatMessage = {
        id: 'msg_user',
        content: 'Created during the wait',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };

      let resolveFetch!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages).mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as Promise<UIChatMessage[]>,
      );

      let resolveTopic!: () => void;
      vi.mocked(topicService.getTopicDetail).mockReturnValue(
        new Promise((resolve) => {
          resolveTopic = () => resolve({ id: context.topicId, status: 'running' });
        }) as ReturnType<typeof topicService.getTopicDetail>,
      );

      seedRows(context, [question]);
      // Two mounted syncs join the same restarted query result. One record is
      // subsumed; its fetch must still use the surviving record after copying
      // the shared array.
      syncMessages(context, { syncInterventions: true });
      syncMessages(context, { syncInterventions: true });

      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalled());
      await act(async () => {
        resolveFetch([answered]);
        await Promise.resolve();
      });
      await waitFor(() => expect(topicService.getTopicDetail).toHaveBeenCalled());

      // The row lands after registration, so only the surviving record sees it.
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: sent.id, type: 'createMessage', value: sent as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );

      await act(async () => {
        resolveTopic();
      });

      await waitFor(() => expect(rowsOf(context)?.map((message) => message.id)).toContain(sent.id));
    });

    it('forgets an unconfirmed id when the local row is deleted', () => {
      const temp: UIChatMessage = {
        id: 'tmp_deleted',
        content: 'Failed send',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: temp.id, type: 'createMessage', value: temp as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );
      const transcript = getMessageTranscript(useChatStore.setState, useChatStore.getState);
      expect(transcript.debugUnconfirmedClientIds()).toContain('tmp_deleted');

      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: temp.id, type: 'deleteMessage' },
          { conversationContext: context },
        );

      expect(transcript.debugUnconfirmedClientIds()).not.toContain('tmp_deleted');
    });

    it('keeps a remapped row when a read issued before its temporary id resolves', async () => {
      const previousReply: UIChatMessage = {
        id: 'previous-reply',
        content: 'Previous reply',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const temp: UIChatMessage = {
        id: 'tmp_client',
        content: 'Sent',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      const persisted: UIChatMessage = { ...temp, id: 'msg_server' };

      // The read starts before the optimistic create.
      let resolveFetch!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages).mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as Promise<UIChatMessage[]>,
      );
      seedRows(context, [previousReply]);
      syncMessages(context);
      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalledTimes(1));

      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: temp.id, type: 'createMessage', value: temp as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );
      // The create succeeds and the server id replaces the temporary one.
      useChatStore.getState().replaceMessages([previousReply, persisted], { context });

      // The pre-create snapshot resolves without the persisted row.
      await act(async () => {
        resolveFetch([{ ...previousReply, content: 'Previous reply (fetched)', updatedAt: 1500 }]);
      });

      await waitFor(() => expect(rowsOf(context)?.[0].content).toBe('Previous reply (fetched)'));
      expect(rowsOf(context)?.map((message) => message.id)).toEqual([
        previousReply.id,
        persisted.id,
      ]);
    });

    it('drops a remapped row omitted by a generation restarted after the remap', async () => {
      const previousReply: UIChatMessage = {
        id: 'previous-reply',
        content: 'Previous reply',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const temp: UIChatMessage = {
        id: 'tmp_client',
        content: 'Sent',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };
      const persisted: UIChatMessage = { ...temp, id: 'msg_server' };

      let resolveFirst!: (messages: UIChatMessage[]) => void;
      let resolveRestarted!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }) as Promise<UIChatMessage[]>,
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveRestarted = resolve;
          }) as Promise<UIChatMessage[]>,
        );
      seedRows(context, [previousReply]);
      syncMessages(context);
      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalledTimes(1));

      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: temp.id, type: 'createMessage', value: temp as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );
      useChatStore.getState().replaceMessages([previousReply, persisted], { context });
      // The cache re-issues the query after the remap.
      invalidateMessageListClientState(() => true);

      resolveFirst([previousReply]);
      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalledTimes(2));

      // The restarted request knew the server id, so omitting it is a remote delete.
      resolveRestarted([previousReply]);

      await waitFor(() =>
        expect(rowsOf(context)?.map((message) => message.id)).toEqual([previousReply.id]),
      );
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
      // The send path creates its optimistic rows through the message dispatch.
      for (const message of [sentUser, sentAssistant]) {
        useChatStore
          .getState()
          .internal_dispatchMessage(
            { id: message.id, type: 'createMessage', value: message as any },
            { conversationContext: context },
            { creationOrigin: 'client' },
          );
      }
      useChatStore.getState().completeOperation(operationId);

      resolveFetch([{ ...previousReply, content: 'Previous reply (fetched)', updatedAt: 1500 }]);

      await waitFor(() => expect(rowsOf(context)?.[0].content).toBe('Previous reply (fetched)'));
      expect(rowsOf(context)?.map((message) => message.id)).toEqual([
        previousReply.id,
        sentUser.id,
        sentAssistant.id,
      ]);
    });

    it('drops a row that only the hydrated page still has when a stale read resolves', async () => {
      const persisted: UIChatMessage[] = [
        {
          id: 'remote-deleted',
          content: 'Deleted on another device',
          role: 'user',
          createdAt: 1000,
          updatedAt: 1000,
        },
        { id: 'kept', content: 'Kept', role: 'user', createdAt: 1001, updatedAt: 1001 },
      ];

      // The read is issued while the bucket is empty: neither row exists yet.
      let resolveFetch!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages).mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as Promise<UIChatMessage[]>,
      );

      // IndexedDB hydration is slower than issuing the read, then lands first.
      // Its page still holds `remote-deleted`, which the server has since removed.
      let resolveHydrate!: () => void;
      const hydrated = new Promise((resolve) => {
        resolveHydrate = () => resolve({ data: transcriptOf(persisted), updatedAt: 1 });
      });
      vi.spyOn(conversationMessagesResource.storage!, 'get').mockImplementation(async (key) =>
        key.queryKey === REPLICA_INDEX_KEY ? undefined : hydrated,
      );

      syncMessages(context);
      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalled());

      await act(async () => {
        resolveHydrate();
        await hydrated;
      });
      await waitFor(() =>
        expect(rowsOf(context)?.map((message) => message.id)).toEqual(['remote-deleted', 'kept']),
      );

      await act(async () => {
        resolveFetch([persisted[1]]);
      });

      // Hydration is not an in-memory write made after the read started, so the
      // server snapshot wins. Before the fix every hydrated row was kept.
      await waitFor(() => expect(rowsOf(context)?.map((message) => message.id)).toEqual(['kept']));
    });

    it('drops a server-applied row that a restarted read omits', async () => {
      const kept: UIChatMessage = {
        id: 'kept',
        content: 'Kept',
        role: 'user',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const alreadyKnown: UIChatMessage = {
        id: 'already-known',
        content: 'Committed before the restarted read',
        role: 'user',
        createdAt: 1001,
        updatedAt: 1001,
      };

      let resolveFirst!: (messages: UIChatMessage[]) => void;
      let resolveRestarted!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveFirst = resolve;
          }) as Promise<UIChatMessage[]>,
        )
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveRestarted = resolve;
          }) as Promise<UIChatMessage[]>,
        );

      seedRows(context, [kept]);
      syncMessages(context);
      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalledTimes(1));

      // The row lands in memory after the first read started, but before the
      // generation is invalidated and the query is physically re-issued.
      useChatStore.getState().replaceMessages([kept, alreadyKnown], { context });
      invalidateMessageListClientState(() => true);

      resolveFirst([kept]);
      await waitFor(() => expect(messageService.getMessages).toHaveBeenCalledTimes(2));

      // The restarted read started after the write, so its omission of the row
      // is authoritative (it was deleted remotely).
      resolveRestarted([kept]);

      await waitFor(() => expect(rowsOf(context)?.map((message) => message.id)).toEqual(['kept']));
    });

    it('keeps a client row created while the fetch waits for the topic decision', async () => {
      const question: UIChatMessage = {
        id: 'question',
        content: '',
        role: 'tool',
        tool_call_id: 'call-1',
        createdAt: 1,
        updatedAt: 1,
        pluginIntervention: { status: 'pending' },
      };
      const answered: UIChatMessage = {
        ...question,
        pluginIntervention: { status: 'approved' },
      };
      const sent: UIChatMessage = {
        id: 'msg_user',
        content: 'Follow-up',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };

      let calls = 0;
      vi.mocked(messageService.getMessages).mockImplementation(() => {
        calls += 1;
        // The forced read is the second call; later reads stay in flight so
        // they cannot repair the row for the assertion.
        return calls <= 2 ? Promise.resolve([answered]) : new Promise(() => {});
      });

      let resolveTopic!: () => void;
      vi.mocked(topicService.getTopicDetail).mockReturnValue(
        new Promise((resolve) => {
          resolveTopic = () => resolve(null);
        }) as ReturnType<typeof topicService.getTopicDetail>,
      );

      seedRows(context, [question]);
      syncMessages(context, { syncInterventions: true });
      await waitFor(() => expect(topicService.getTopicDetail).toHaveBeenCalled());

      // The send lands after the first read resolved but before the topic
      // decision returns — the gap where a later read used to prune its mark.
      useChatStore
        .getState()
        .internal_dispatchMessage(
          { id: sent.id, type: 'createMessage', value: sent as any },
          { conversationContext: context },
          { creationOrigin: 'client' },
        );

      await act(async () => {
        resolveTopic();
      });

      await waitFor(() =>
        expect(rowsOf(context)?.map((message) => message.id)).toEqual(['question', 'msg_user']),
      );
    });
  });
});
