import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import MiniGame from './index';

const state = vi.hoisted(() => ({ flag: true, heterogeneous: false }));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serverConfigSelectors: { enableMiniGame: () => state.flag },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: { isAgentHeterogeneousById: () => () => state.heterogeneous },
}));
vi.mock('../../hooks/useAgentId', () => ({ useAgentId: () => 'agt_1' }));
vi.mock('../components/ChatInputAction', () => ({
  ChatInputAction: ({ onClick, title }: { onClick: () => void; title: string }) => (
    <button onClick={onClick}>{title}</button>
  ),
}));

beforeEach(() => {
  state.flag = true;
  state.heterogeneous = false;
  useChatStore.setState({ portalStack: [], showPortal: false });
});

describe('MiniGame action', () => {
  it('opens and closes the mini game beside the chat', () => {
    render(<MiniGame />);
    fireEvent.click(screen.getByRole('button', { name: 'miniGame.open' }));
    expect(useChatStore.getState().portalStack.at(-1)).toEqual({ type: PortalViewType.MiniGame });

    fireEvent.click(screen.getByRole('button', { name: 'miniGame.close' }));
    expect(useChatStore.getState().showPortal).toBe(false);
  });

  it('is hidden while the flag is off', () => {
    state.flag = false;
    const { container } = render(<MiniGame />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden for heterogeneous agents, which have no game tool', () => {
    state.heterogeneous = true;
    const { container } = render(<MiniGame />);
    expect(container).toBeEmptyDOMElement();
  });
});
