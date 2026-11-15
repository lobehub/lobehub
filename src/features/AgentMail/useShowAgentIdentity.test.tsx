import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useShowAgentIdentity } from './useShowAgentIdentity';

const mocks = vi.hoisted(() => ({
  serverState: { serverConfig: { agentIdentityProviders: [] as string[] } },
  userState: { preference: { lab: { enableAgentIdentity: false } } },
}));

const accountService = vi.hoisted(() => ({ list: vi.fn(async () => [] as unknown[]) }));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: accountService }));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: typeof mocks.serverState) => unknown) =>
    selector(mocks.serverState),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    agentIdentityProviders: (state: typeof mocks.serverState) =>
      state.serverConfig.agentIdentityProviders,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableAgentIdentity: (state: typeof mocks.userState) =>
      state.preference.lab.enableAgentIdentity,
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>{children}</SWRConfig>
);

describe('useShowAgentIdentity', () => {
  beforeEach(() => {
    accountService.list.mockClear();
    mocks.userState.preference.lab.enableAgentIdentity = false;
    mocks.serverState.serverConfig.agentIdentityProviders = [];
  });

  it('needs the Labs toggle even with a provider configured', () => {
    mocks.serverState.serverConfig.agentIdentityProviders = ['agent-mail'];

    const { result } = renderHook(() => useShowAgentIdentity('agt_1'), { wrapper });

    expect(result.current).toBe(false);
  });

  it('shows with the Labs toggle on and a provider configured', () => {
    mocks.userState.preference.lab.enableAgentIdentity = true;
    mocks.serverState.serverConfig.agentIdentityProviders = ['agent-mail'];

    const { result } = renderHook(() => useShowAgentIdentity('agt_1'), { wrapper });

    expect(result.current).toBe(true);
  });

  it('hides when the deployment has no provider and the agent owns no address', () => {
    mocks.userState.preference.lab.enableAgentIdentity = true;

    const { result } = renderHook(() => useShowAgentIdentity('agt_1'), { wrapper });

    expect(result.current).toBe(false);
  });

  it('stays reachable for an agent that already owns an address, even with no provider', async () => {
    mocks.userState.preference.lab.enableAgentIdentity = true;
    accountService.list.mockResolvedValueOnce([
      { id: 'acc_1', identifier: 'toby@lobe.id', status: 'active' },
    ]);

    const { result } = renderHook(() => useShowAgentIdentity('agt_1'), { wrapper });

    await waitFor(() => expect(result.current).toBe(true));
    expect(accountService.list).toHaveBeenCalledWith({ agentId: 'agt_1' });
  });
});
