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
  });

  it('hydrates legacy topic query params into the store and rewrites them to the topic path', async () => {
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
      expect(useChatStore.getState().activeTopicId).toBe('tpc_123');
      expect(useChatStore.getState().activeThreadId).toBe('thd_456');
      expect(navigateMock).toHaveBeenCalledWith(
        '/agent/agt_test/tpc_123?thread=thd_456&mode=single#msg_1',
        { replace: true },
      );
    });
  });

  it('removes duplicate legacy topic query params when the path already carries topicId', async () => {
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
      expect(navigateMock).toHaveBeenCalledWith('/agent/agt_test/tpc_123?thread=thd_456', {
        replace: true,
      });
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
