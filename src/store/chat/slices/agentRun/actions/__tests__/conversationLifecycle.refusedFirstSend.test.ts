import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft } from '@/features/ChatInput/draftStorage';
import { agentService } from '@/services/agent';
import { agentRunSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSessionStoreState } from '@/store/session';
import { useUserStore } from '@/store/user';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

vi.mock('../transports/hetero/heterogeneousAgentExecutor', () => ({
  executeHeterogeneousAgent: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: { updateSession: { mutate: vi.fn().mockResolvedValue(undefined) } },
  },
}));

const typedDraft = { root: { children: [], type: 'root' } };

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  localStorage.clear();
  vi.spyOn(getSessionStoreState(), 'triggerSessionUpdate').mockResolvedValue(undefined);
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);
  useUserStore.setState({ workspaceUserPreference: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendMessage refused by the server on a new topic', () => {
  it.each(['new draft', 'another topic'])(
    'keeps the refused payload recoverable after %s',
    async (change) => {
      const context = { agentId: TEST_IDS.SESSION_ID, topicId: 'existing-topic' };
      const contextKey = messageMapKey(context);
      let document = typedDraft;
      let ownsEditor = true;
      let reject!: (error: Error) => void;
      const editor = {
        getDocument: () => document,
        setDocument: vi.fn(),
      };
      useChatStore.setState({
        activeAgentId: context.agentId,
        activeTopicId: context.topicId,
        executeGatewayAgent: vi.fn(
          () =>
            new Promise((_, fail) => {
              reject = fail;
            }),
        ) as any,
        isGatewayModeEnabled: () => true,
        refreshMessages: vi.fn(),
        refreshTopic: vi.fn(),
      });
      const sending = useChatStore.getState().sendMessage({
        context,
        editorData: typedDraft,
        inputEditor: editor as any,
        isInputEditorCurrent: () => ownsEditor,
        message: 'refused follow-up',
      });
      await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
      if (change === 'new draft') document = { root: { children: [], type: 'new-draft' } };
      else ownsEditor = false;
      reject(new Error('Gateway refused startup'));
      await sending;

      const state = useChatStore.getState();
      expect(editor.setDocument).not.toHaveBeenCalled();
      expect(state.failedSendDrafts[contextKey]).toEqual([
        expect.objectContaining({ editorData: typedDraft, message: 'refused follow-up' }),
      ]);
      expect(state.dbMessagesMap[contextKey]).toEqual([]);
      state.cleanupCompletedOperations(-1);
      expect(useChatStore.getState().failedSendDrafts[contextKey]).toHaveLength(1);
      expect(
        useChatStore.getState().failedSendDrafts[messageMapKey({ ...context, topicId: 'other' })],
      ).toBeUndefined();
    },
  );

  // ROOT CAUSE:
  //
  // A first send mints a topic, and its operation, error notice and restored
  // draft are all keyed by that topic. When the server refuses to start the run
  // (for example, too many runs already in flight), the minted topic rolls back
  // and the composer returns to the blank conversation, whose key holds neither.
  //
  // Before the fix, the user saw no notice and lost the typed message.
  it.each(['wrapped', 'native'])(
    'keeps the notice and the typed message with a %s editor',
    async (editorKind) => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const editor = {
        clearContent: vi.fn(),
        ...(editorKind === 'wrapped'
          ? { getJSONState: vi.fn(() => typedDraft), setJSONState: vi.fn() }
          : { getDocument: vi.fn(() => typedDraft) }),
        getMarkdownContent: vi.fn(() => 'hello'),
        setDocument: vi.fn(),
      };

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: null,
          executeClientAgent: vi.fn(),
          executeGatewayAgent: vi
            .fn()
            .mockRejectedValue(new Error('AgentConcurrencyLimitExceeded')),
          isGatewayModeEnabled: () => true,
          mainInputEditor: editor as any,
          refreshMessages: vi.fn(),
          refreshTopic: vi.fn(),
        });
      });

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId: null },
          editorData: typedDraft,
          message: 'hello',
        });
      });

      const state = useChatStore.getState();
      expect(state.activeTopicId).toBeNull();
      expect(agentRunSelectors.isCurrentSendMessageError(state)).toBe(
        'AgentConcurrencyLimitExceeded',
      );
      expect(getDraft(messageMapKey({ agentId, threadId: null, topicId: null }))).toEqual(
        typedDraft,
      );
      if (editorKind === 'native') {
        expect(editor.setDocument).toHaveBeenCalledWith('json', JSON.stringify(typedDraft));
      } else {
        expect(editor.setJSONState).toHaveBeenCalledWith(typedDraft);
      }
      const key = messageMapKey({ agentId, threadId: null, topicId: null });
      const gatewayContext = vi.mocked(state.executeGatewayAgent).mock.calls[0][0].messageContext;
      const optimisticKey = messageMapKey(gatewayContext!);
      expect(optimisticKey).not.toBe(key);
      expect(state.dbMessagesMap[optimisticKey]).toEqual([]);
    },
  );
});
