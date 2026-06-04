/**
 * @vitest-environment happy-dom
 */
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import ChatHydration from './index';

const navigateMock = vi.hoisted(() => vi.fn());
const setSearchParamsMock = vi.hoisted(() => vi.fn());
const useLocationMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

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
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    useLocation: useLocationMock,
    useNavigate: () => navigateMock,
    useParams: useParamsMock,
    useSearchParams: useSearchParamsMock,
  };
});

describe('ChatHydration', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setSearchParamsMock.mockReset();
    useLocationMock.mockReset();
    useParamsMock.mockReset();
    useSearchParamsMock.mockReset();

    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agt_test',
        activeThreadId: undefined,
        activeTopicId: undefined,
      },
      false,
    );
    useAgentStore.setState(
      {
        activeAgentId: 'agt_test',
        agentMap: {
          agt_test: {
            agencyConfig: {
              heterogeneousProvider: { type: 'claude-code' },
            },
          } as any,
        },
      },
      false,
    );
  });

  it('ignores topic query params and only hydrates thread from search params', async () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test' });
    useLocationMock.mockReturnValue({
      hash: '#msg_1',
      pathname: '/agent/agt_test',
      search: '?topic=tpc_123&thread=thd_456&mode=single',
    });
    useSearchParamsMock.mockReturnValue([
      new URLSearchParams('topic=tpc_123&thread=thd_456&mode=single'),
      setSearchParamsMock,
    ]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBeNull();
      expect(useChatStore.getState().activeThreadId).toBe('thd_456');
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it('hydrates topic from the path and triggers Claude Code history sync when topic data is loaded', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValue('synced');
    useChatStore.setState(
      {
        syncClaudeCodeHistory,
        topicDataMap: {
          agent_agt_test: {
            currentPage: 0,
            hasMore: false,
            items: [{ id: 'tpc_123', metadata: { heteroSessionId: 'cc-session' } } as any],
            pageSize: 20,
            total: 1,
          },
        },
      },
      false,
    );
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '?topic=tpc_999&thread=thd_456',
    });
    useSearchParamsMock.mockReturnValue([
      new URLSearchParams('topic=tpc_999&thread=thd_456'),
      setSearchParamsMock,
    ]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBe('tpc_123');
      expect(useChatStore.getState().activeThreadId).toBe('thd_456');
      expect(navigateMock).not.toHaveBeenCalled();
      expect(syncClaudeCodeHistory).toHaveBeenCalledWith('tpc_123');
    });

    act(() => {
      useChatStore.setState(
        {
          topicDataMap: {
            agent_agt_test: {
              currentPage: 0,
              hasMore: false,
              items: [
                {
                  id: 'tpc_123',
                  metadata: {
                    claudeCodeHistorySyncedAt: '2026-05-17T00:00:00.000Z',
                    heteroSessionId: 'cc-session',
                  },
                } as any,
              ],
              pageSize: 20,
              total: 1,
            },
          },
        },
        false,
      );
    });

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(1);
    });
  });

  it('does not trigger Claude Code history sync for non-Claude-Code providers', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValue('synced');
    useChatStore.setState(
      {
        syncClaudeCodeHistory,
        topicDataMap: {
          agent_agt_test: {
            currentPage: 0,
            hasMore: false,
            items: [{ id: 'tpc_123', metadata: { heteroSessionId: 'cc-session' } } as any],
            pageSize: 20,
            total: 1,
          },
        },
      },
      false,
    );
    useAgentStore.setState(
      {
        activeAgentId: 'agt_test',
        agentMap: {
          agt_test: {
            agencyConfig: {
              heterogeneousProvider: { type: 'codex' },
            },
          } as any,
        },
      },
      false,
    );
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBe('tpc_123');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncClaudeCodeHistory).not.toHaveBeenCalled();
  });

  it('does not trigger Claude Code history sync without a routed session id', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValue('synced');
    useChatStore.setState(
      {
        syncClaudeCodeHistory,
        topicDataMap: {
          agent_agt_test: {
            currentPage: 0,
            hasMore: false,
            items: [{ id: 'tpc_123', metadata: {} } as any],
            pageSize: 20,
            total: 1,
          },
        },
      },
      false,
    );
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBe('tpc_123');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncClaudeCodeHistory).not.toHaveBeenCalled();
  });

  it('allows a new route topic to sync after the previous route topic completed', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValue('synced');
    useChatStore.setState(
      {
        syncClaudeCodeHistory,
        topicDataMap: {
          agent_agt_test: {
            currentPage: 0,
            hasMore: false,
            items: [
              { id: 'tpc_123', metadata: { heteroSessionId: 'cc-session-1' } } as any,
              { id: 'tpc_456', metadata: { heteroSessionId: 'cc-session-2' } } as any,
            ],
            pageSize: 20,
            total: 2,
          },
        },
      },
      false,
    );
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledWith('tpc_123');
    });

    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_456' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_456',
      search: '',
    });
    act(() => {
      useChatStore.setState({ activeTopicId: undefined }, false);
    });

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBe('tpc_456');
      expect(syncClaudeCodeHistory).toHaveBeenCalledWith('tpc_456');
    });
    expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(2);
  });

  it('does not permanently mark routed sync as complete after a rejected sync attempt', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const syncClaudeCodeHistory = vi
      .fn()
      .mockRejectedValueOnce(new Error('sync failed'))
      .mockResolvedValueOnce('synced');
    useChatStore.setState(
      {
        syncClaudeCodeHistory,
        topicDataMap: {
          agent_agt_test: {
            currentPage: 0,
            hasMore: false,
            items: [{ id: 'tpc_123', metadata: { heteroSessionId: 'cc-session' } } as any],
            pageSize: 20,
            total: 1,
          },
        },
      },
      false,
    );
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
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

  it('does not mark routed sync as complete when the topic is not active yet', async () => {
    const syncClaudeCodeHistory = vi.fn().mockResolvedValue('skipped');
    useChatStore.setState(
      {
        activeTopicId: 'tpc_previous',
        syncClaudeCodeHistory,
        topicDataMap: {
          agent_agt_test: {
            currentPage: 0,
            hasMore: false,
            items: [{ id: 'tpc_123', metadata: { heteroSessionId: 'cc-session' } } as any],
            pageSize: 20,
            total: 1,
          },
        },
      },
      false,
    );
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBe('tpc_123');
      expect(syncClaudeCodeHistory).toHaveBeenCalledWith('tpc_123');
    });

    syncClaudeCodeHistory.mockResolvedValue('synced');
    act(() => {
      useChatStore.setState({ activeTopicId: 'tpc_previous' }, false);
    });
    act(() => {
      useChatStore.setState({ activeTopicId: 'tpc_123' }, false);
    });

    await waitFor(() => {
      expect(syncClaudeCodeHistory).toHaveBeenCalledTimes(2);
    });
  });

  it('clears stale topic and thread state when the route has no topic or thread', async () => {
    useChatStore.setState(
      {
        activeThreadId: 'thd_previous',
        activeTopicId: 'tpc_previous',
      },
      false,
    );

    useParamsMock.mockReturnValue({ aid: 'agt_next' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_next',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);

    render(<ChatHydration />);

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBeNull();
      expect(useChatStore.getState().activeThreadId).toBeNull();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it('rewrites the pathname when the active topic changes in the chat store', async () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_123' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/agent/agt_test/tpc_123',
      search: '?thread=thd_456',
    });
    useSearchParamsMock.mockReturnValue([
      new URLSearchParams('thread=thd_456'),
      setSearchParamsMock,
    ]);

    render(<ChatHydration />);

    navigateMock.mockClear();

    await act(async () => {
      useChatStore.setState({ activeTopicId: 'tpc_789' }, false);
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/agent/agt_test/tpc_789?thread=thd_456', {
        replace: true,
      });
    });
  });
});
