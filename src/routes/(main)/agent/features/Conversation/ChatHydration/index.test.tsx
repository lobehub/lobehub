/**
 * @vitest-environment happy-dom
 */
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { useChatStore } from '@/store/chat/store';

import ChatHydration from './index';

const navigateMock = vi.hoisted(() => vi.fn());
const setSearchParamsMock = vi.hoisted(() => vi.fn());
const useLocationMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());
const workspaceMock = vi.hoisted(() => ({ activeSlug: null as string | null }));

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

vi.mock('react-router', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router')) as typeof import('react-router');

  return {
    ...actual,
    useLocation: useLocationMock,
    useNavigate: () => navigateMock,
    useParams: useParamsMock,
    useSearchParams: useSearchParamsMock,
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => workspaceMock.activeSlug,
  useActiveWorkspaceSlug: () => workspaceMock.activeSlug,
}));

describe('ChatHydration', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    setSearchParamsMock.mockReset();
    useLocationMock.mockReset();
    useParamsMock.mockReset();
    useSearchParamsMock.mockReset();
    workspaceMock.activeSlug = null;

    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agt_test',
        activeThreadId: undefined,
        activeTopicId: undefined,
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

  it('hydrates topic from the path even when a stale topic query param exists', async () => {
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

  it('preserves the routed topic when the workspace activates after mount', async () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_previous' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/acme/agent/agt_test/tpc_previous',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);
    useChatStore.setState({ activeTopicId: 'tpc_previous' }, false);

    render(<ChatHydration />);
    navigateMock.mockClear();

    // Workspace URL sync updates the Zustand store before React can rerender
    // consumers of the active slug. Resetting workspace-scoped chat state in
    // that same call stack must rehydrate the routed topic without navigating.
    workspaceMock.activeSlug = 'acme';
    await act(async () => {
      useChatStore.setState({ activeTopicId: undefined }, false);
    });

    await waitFor(() => {
      expect(useChatStore.getState().activeTopicId).toBe('tpc_previous');
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it('still clears the routed topic after an explicit topic switch', async () => {
    workspaceMock.activeSlug = 'acme';
    useParamsMock.mockReturnValue({ aid: 'agt_test', topicId: 'tpc_previous' });
    useLocationMock.mockReturnValue({
      hash: '',
      pathname: '/acme/agent/agt_test/tpc_previous',
      search: '',
    });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), setSearchParamsMock]);
    useChatStore.setState({ activeTopicId: 'tpc_previous' }, false);

    render(<ChatHydration />);
    navigateMock.mockClear();

    await act(async () => {
      await useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/acme/agent/agt_test', { replace: true });
    });
  });
});
