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
  // ROOT CAUSE:
  //
  // A first send mints a topic, and its operation, error notice and restored
  // draft are all keyed by that topic. When the server refuses to start the run
  // (for example, too many runs already in flight), the minted topic rolls back
  // and the composer returns to the blank conversation, whose key holds neither.
  //
  // Before the fix, the user saw no notice and lost the typed message.
  it('keeps the notice and the typed message in the blank conversation', async () => {
    const { result } = renderHook(() => useChatStore());
    const agentId = TEST_IDS.SESSION_ID;
    const editor = {
      clearContent: vi.fn(),
      getJSONState: vi.fn(() => typedDraft),
      getMarkdownContent: vi.fn(() => 'hello'),
      setDocument: vi.fn(),
      setJSONState: vi.fn(),
    };

    act(() => {
      useChatStore.setState({
        activeAgentId: agentId,
        activeTopicId: null,
        executeClientAgent: vi.fn(),
        executeGatewayAgent: vi.fn().mockRejectedValue(new Error('AgentConcurrencyLimitExceeded')),
        isGatewayModeEnabled: () => true,
        mainInputEditor: editor as any,
        refreshMessages: vi.fn(),
        refreshTopic: vi.fn(),
      });
    });

    await act(async () => {
      await result.current.sendMessage({
        context: { agentId, threadId: null, topicId: null },
        message: 'hello',
      });
    });

    const state = useChatStore.getState();
    expect(state.activeTopicId).toBeNull();
    expect(agentRunSelectors.isCurrentSendMessageError(state)).toBe(
      'AgentConcurrencyLimitExceeded',
    );
    expect(getDraft(messageMapKey({ agentId, threadId: null, topicId: null }))).toEqual(typedDraft);
  });
});
