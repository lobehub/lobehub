/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialState as initialChatState } from '@/store/chat/initialState';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useChatStore } from '@/store/chat/store';

import AgentIdSync from './AgentIdSync';

const useParamsMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    useParams: useParamsMock,
    useSearchParams: useSearchParamsMock,
  };
});

describe('AgentIdSync', () => {
  beforeEach(() => {
    useParamsMock.mockReset();
    useSearchParamsMock.mockReset();

    useChatStore.setState(
      {
        ...initialChatState,
        activeAgentId: 'agent-1',
        activeTopicId: 'topic-1',
        portalStack: [{ type: PortalViewType.Home }],
        showPortal: true,
      },
      false,
    );
  });

  it('clears portal state when switching to another agent without a topic in the URL', () => {
    useParamsMock.mockReturnValue({ aid: 'agent-1' });
    useSearchParamsMock.mockReturnValue([new URLSearchParams(''), vi.fn()]);

    const { rerender } = render(<AgentIdSync />);

    expect(useChatStore.getState().showPortal).toBe(true);

    useParamsMock.mockReturnValue({ aid: 'agent-2' });
    rerender(<AgentIdSync />);

    expect(useChatStore.getState().activeTopicId).toBeNull();
    expect(useChatStore.getState().portalStack).toEqual([]);
    expect(useChatStore.getState().showPortal).toBe(false);
  });

  it('still clears portal state when the destination URL already has a topic', () => {
    useParamsMock.mockReturnValue({ aid: 'agent-1' });
    useSearchParamsMock.mockReturnValue([new URLSearchParams('topic=topic-2'), vi.fn()]);

    const { rerender } = render(<AgentIdSync />);

    useParamsMock.mockReturnValue({ aid: 'agent-2' });
    rerender(<AgentIdSync />);

    expect(useChatStore.getState().portalStack).toEqual([]);
    expect(useChatStore.getState().showPortal).toBe(false);
  });
});
