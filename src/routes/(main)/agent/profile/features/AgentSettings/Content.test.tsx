import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSettingsTabs } from '@/store/global/initialState';

import Content from './Content';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'inbox-agent',
    config: {},
    isCurrentAgentHeterogeneous: false,
    isInbox: true,
    meta: {},
    optimisticUpdateAgentConfig: vi.fn(),
    optimisticUpdateAgentMeta: vi.fn(),
  },
  serverState: { serverConfig: { agentIdentityProviders: [] as string[] } },
  userState: { preference: { lab: { enableAgentGraphConfig: false, enableAgentIdentity: false } } },
}));

vi.mock('@/features/AgentSetting', () => ({
  AgentSettings: ({ tab }: { tab: ChatSettingsTabs }) => (
    <div data-tab={tab} data-testid="agent-settings-content" />
  ),
  SettingsModalLayout: ({
    activeTab,
    tabs = [],
    children,
  }: {
    activeTab?: string;
    children?: ReactNode;
    tabs?: { key: string }[];
  }) => (
    <div
      data-active={activeTab}
      data-tabs={tabs.map((tab) => tab.key).join(',')}
      data-testid="layout"
    >
      {children}
    </div>
  ),
}));

const accountService = vi.hoisted(() => ({ list: vi.fn(async () => [] as unknown[]) }));
vi.mock('@/services/agentAccount', () => ({ agentAccountService: accountService }));

vi.mock('@/store/agent', () => {
  const useAgentStore = (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState);
  useAgentStore.getState = () => mocks.agentState;

  return { useAgentStore };
});

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentConfig: (state: typeof mocks.agentState) => state.config,
    currentAgentMeta: (state: typeof mocks.agentState) => state.meta,
    isCurrentAgentHeterogeneous: (state: typeof mocks.agentState) =>
      state.isCurrentAgentHeterogeneous,
  },
  builtinAgentSelectors: {
    isInboxAgent: (state: typeof mocks.agentState) => state.isInbox,
  },
}));

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
    enableAgentGraphConfig: (state: typeof mocks.userState) =>
      state.preference.lab.enableAgentGraphConfig,
    enableAgentIdentity: (state: typeof mocks.userState) =>
      state.preference.lab.enableAgentIdentity,
  },
}));

describe('AgentSettings Content', () => {
  beforeEach(() => {
    mocks.agentState.isInbox = true;
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.userState.preference.lab.enableAgentGraphConfig = false;
    mocks.userState.preference.lab.enableAgentIdentity = false;
    mocks.serverState.serverConfig.agentIdentityProviders = [];
  });

  it('opens on the opening tab', () => {
    render(<Content />);

    const layout = screen.getByTestId('layout');
    expect(layout).toHaveAttribute('data-active', ChatSettingsTabs.Opening);
    expect(layout).toHaveAttribute('data-tabs', ChatSettingsTabs.Opening);
    expect(screen.getByTestId('agent-settings-content')).toHaveAttribute(
      'data-tab',
      ChatSettingsTabs.Opening,
    );
  });

  it('adds the graph tab for custom agents when its Labs switch is on', () => {
    mocks.agentState.isInbox = false;
    mocks.userState.preference.lab.enableAgentGraphConfig = true;

    render(<Content />);

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-tabs',
      `${ChatSettingsTabs.Opening},${ChatSettingsTabs.Graph}`,
    );
  });

  it('keeps the graph tab off for inbox even with its Labs switch on', () => {
    mocks.userState.preference.lab.enableAgentGraphConfig = true;

    render(<Content />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-tabs', ChatSettingsTabs.Opening);
  });

  it('shows identity only with the Labs toggle on and a provider configured', () => {
    mocks.serverState.serverConfig.agentIdentityProviders = ['agent-mail'];

    const { unmount } = render(<Content />);
    // A configured provider alone does not surface the experiment.
    expect(screen.getByTestId('layout')).toHaveAttribute('data-tabs', ChatSettingsTabs.Opening);
    unmount();

    mocks.userState.preference.lab.enableAgentIdentity = true;
    render(<Content />);
    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-tabs',
      `${ChatSettingsTabs.Opening},${ChatSettingsTabs.Identity}`,
    );
  });

  it('hides identity when the deployment has no identity provider, even in Labs', () => {
    mocks.userState.preference.lab.enableAgentIdentity = true;

    render(<Content />);

    expect(screen.getByTestId('layout')).toHaveAttribute('data-tabs', ChatSettingsTabs.Opening);
  });

  it('keeps identity reachable for an agent that already owns an address, even with no provider', async () => {
    mocks.userState.preference.lab.enableAgentIdentity = true;
    accountService.list.mockResolvedValueOnce([
      { id: 'acc_1', identifier: 'toby@lobe.id', status: 'active' },
    ]);

    render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <Content />
      </SWRConfig>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('layout')).toHaveAttribute(
        'data-tabs',
        `${ChatSettingsTabs.Opening},${ChatSettingsTabs.Identity}`,
      ),
    );
    expect(accountService.list).toHaveBeenCalledWith({ agentId: 'inbox-agent' });
  });
});
