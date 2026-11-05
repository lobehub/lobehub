import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

import { useCloseUnavailableMiniGame, useMiniGameAvailable } from './useMiniGameAvailable';

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

beforeEach(() => {
  state.flag = true;
  state.heterogeneous = false;
  act(() =>
    useChatStore.setState({ portalStack: [{ type: PortalViewType.MiniGame }], showPortal: true }),
  );
});

describe('useMiniGameAvailable', () => {
  it('is available with the flag on for a LobeHub-runtime agent', () => {
    expect(renderHook(() => useMiniGameAvailable('agt_1')).result.current).toBe(true);
  });

  it('is unavailable while the flag is off', () => {
    state.flag = false;
    expect(renderHook(() => useMiniGameAvailable('agt_1')).result.current).toBe(false);
  });

  it('is unavailable for heterogeneous agents, which have no game tool', () => {
    state.heterogeneous = true;
    expect(renderHook(() => useMiniGameAvailable('agt_cc')).result.current).toBe(false);
  });
});

describe('useCloseUnavailableMiniGame', () => {
  it('keeps the open game while it is available', () => {
    renderHook(() => useCloseUnavailableMiniGame('agt_1'));
    expect(useChatStore.getState().showPortal).toBe(true);
  });

  it('closes the open game once the agent can no longer play it', () => {
    const { rerender } = renderHook(() => useCloseUnavailableMiniGame('agt_1'));
    expect(useChatStore.getState().showPortal).toBe(true);

    // e.g. the user switched to a heterogeneous agent with the game still open
    state.heterogeneous = true;
    rerender();
    expect(useChatStore.getState().showPortal).toBe(false);
  });
});
