/**
 * @vitest-environment happy-dom
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import type * as ReactRouterDom from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { initialState as initialAgentState } from '@/store/agent/initialState';
import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import PopupAgentTopicPage from './index';

const useParamsMock = vi.hoisted(() => vi.fn());
const useFetchTopicsMock = vi.hoisted(() => vi.fn());
const useInitAgentConfigMock = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  const storage = {
    clear: vi.fn(),
    getItem: vi.fn(() => null),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');

  return {
    ...actual,
    useParams: useParamsMock,
  };
});

vi.mock('@/hooks/useFetchTopics', () => ({
  useFetchTopics: useFetchTopicsMock,
}));

vi.mock('@/hooks/useInitAgentConfig', () => ({
  useInitAgentConfig: useInitAgentConfigMock,
}));

vi.mock('@/routes/(main)/agent/features/Conversation', () => ({
  default: () => <div data-testid="popup-conversation" />,
}));

const setClaudeCodeAgent = (agentId: string) => {
  useAgentStore.setState(
    {
      activeAgentId: agentId,
      agentMap: {
        [agentId]: {
          agencyConfig: {
            heterogeneousProvider: { type: 'claude-code' },
          },
        } as any,
      },
    },
    false,
  );
};

const setTopicWithSession = (agentId: string, topicId: string, workingDirectory?: string) => {
  useChatStore.setState(
    {
      topicDataMap: {
        [`agent_${agentId}`]: {
          currentPage: 0,
          hasMore: false,
          items: [
            {
              id: topicId,
              metadata: { heteroSessionId: 'cc-session-id', workingDirectory },
              title: 'Claude Code Topic',
            } as any,
          ],
          pageSize: 20,
          total: 1,
        },
      },
    },
    false,
  );
};

describe('PopupAgentTopicPage', () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useFetchTopicsMock.mockReset();
    useInitAgentConfigMock.mockReset();

    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: undefined,
        activeGroupId: 'stale-group',
        activeThreadId: 'stale-thread',
        activeTopicId: undefined,
        topicDataMap: {},
      },
      false,
    );
    useAgentStore.setState(
      {
        ...initialAgentState,
        activeAgentId: undefined,
      },
      false,
    );
  });

  it('syncs popup route params into stores and renders the conversation', async () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test', tid: 'tpc_123' });

    render(<PopupAgentTopicPage />);

    expect(useInitAgentConfigMock).toHaveBeenCalledWith('agt_test');
    expect(useFetchTopicsMock).toHaveBeenCalled();
    expect(screen.getByTestId('popup-conversation')).toBeInTheDocument();

    await waitFor(() => {
      expect(useAgentStore.getState().activeAgentId).toBe('agt_test');
      expect(useChatStore.getState().activeAgentId).toBe('agt_test');
      expect(useChatStore.getState().activeGroupId).toBeUndefined();
      expect(useChatStore.getState().activeThreadId).toBeUndefined();
      expect(useChatStore.getState().activeTopicId).toBe('tpc_123');
    });
  });

  it('returns null and avoids store sync when route params are missing', async () => {
    useParamsMock.mockReturnValue({});

    render(<PopupAgentTopicPage />);

    expect(useInitAgentConfigMock).toHaveBeenCalledWith(undefined);
    expect(useFetchTopicsMock).toHaveBeenCalled();
    expect(screen.queryByTestId('popup-conversation')).not.toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(useChatStore.getState().activeAgentId).toBeUndefined();
    expect(useChatStore.getState().activeTopicId).toBeUndefined();
  });

  it('triggers Claude Code history sync once for an already synced popup topic', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValue('synced');

    setClaudeCodeAgent('agt_test');
    setTopicWithSession('agt_test', 'tpc_123');
    useChatStore.setState({ syncClaudeCodeHistory }, false);
    useParamsMock.mockReturnValue({ aid: 'agt_test', tid: 'tpc_123' });

    render(<PopupAgentTopicPage />);

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledWith('tpc_123');
    });

    act(() => {
      setTopicWithSession('agt_test', 'tpc_123', '/new/project/path');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(1);
  });

  it('allows a skipped popup sync to retry after topic metadata changes', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValueOnce('skipped').mockResolvedValue('synced');

    setClaudeCodeAgent('agt_test');
    setTopicWithSession('agt_test', 'tpc_123');
    useChatStore.setState({ syncClaudeCodeHistory }, false);
    useParamsMock.mockReturnValue({ aid: 'agt_test', tid: 'tpc_123' });

    render(<PopupAgentTopicPage />);

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(1);
    });

    act(() => {
      setTopicWithSession('agt_test', 'tpc_123', '/retry/project/path');
    });

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(2);
    });
  });

  it('does not permanently block popup sync after a rejected attempt', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const syncClaudeCodeHistory = vi
      .fn()
      .mockRejectedValueOnce(new Error('sync failed'))
      .mockResolvedValueOnce('synced');

    setClaudeCodeAgent('agt_test');
    setTopicWithSession('agt_test', 'tpc_123');
    useChatStore.setState({ syncClaudeCodeHistory }, false);
    useParamsMock.mockReturnValue({ aid: 'agt_test', tid: 'tpc_123' });

    render(<PopupAgentTopicPage />);

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    act(() => {
      useChatStore.setState({ activeTopicId: 'tpc_previous' }, false);
    });
    act(() => {
      useChatStore.setState({ activeTopicId: 'tpc_123' }, false);
    });

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(2);
    });

    consoleErrorSpy.mockRestore();
  });
});
