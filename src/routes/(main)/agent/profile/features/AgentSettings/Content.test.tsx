import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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
  userState: { preference: { lab: { enableAgentGraphConfig: false } } },
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

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.userState) => unknown) => selector(mocks.userState),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableAgentGraphConfig: (state: typeof mocks.userState) =>
      state.preference.lab.enableAgentGraphConfig,
  },
}));

describe('AgentSettings Content', () => {
  beforeEach(() => {
    mocks.agentState.isInbox = true;
    mocks.agentState.isCurrentAgentHeterogeneous = false;
    mocks.userState.preference.lab.enableAgentGraphConfig = false;
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
});
