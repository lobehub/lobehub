import { render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatSettingsTabs } from '@/store/global/initialState';

import Content from './Content';

const mocks = vi.hoisted(() => ({
  agentState: {
    activeAgentId: 'inbox-agent',
    config: {},
    isInbox: true,
    meta: {},
    optimisticUpdateAgentConfig: vi.fn(),
    optimisticUpdateAgentMeta: vi.fn(),
  },
  serverState: {
    featureFlags: {
      enableAgentSelfIteration: true,
    },
  },
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: () => <div data-testid="avatar" />,
  Block: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Flexbox: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Icon: () => <span />,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('@/components/Menu', () => ({
  default: ({
    items = [],
    onClick,
    selectedKeys = [],
  }: {
    items?: { key?: string; label?: ReactNode }[];
    onClick?: ({ key }: { key: string }) => void;
    selectedKeys?: string[];
  }) => (
    <div data-selected={selectedKeys.join(',')} data-testid="agent-settings-menu">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => item.key && onClick?.({ key: item.key })}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/features/AgentSetting', () => ({
  AgentSettings: ({ tab }: { tab: ChatSettingsTabs }) => (
    <div data-tab={tab} data-testid="agent-settings-content" />
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
    getAgentConfigById: () => (state: typeof mocks.agentState) => state.config,
    getAgentMetaById: () => (state: typeof mocks.agentState) => state.meta,
  },
  builtinAgentSelectors: {
    inboxAgentId: () => 'inbox-agent',
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ aid: mocks.agentState.isInbox ? 'inbox-agent' : 'other-agent' }),
}));

vi.mock('@/store/serverConfig', () => ({
  featureFlagsSelectors: (state: typeof mocks.serverState) => state.featureFlags,
  useServerConfigStore: (selector: (state: typeof mocks.serverState) => unknown) =>
    selector(mocks.serverState),
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({
    colorBgLayout: '#fff',
    colorBorderSecondary: '#eee',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('AgentSettings Content', () => {
  beforeEach(() => {
    mocks.agentState.isInbox = true;
    mocks.serverState.featureFlags.enableAgentSelfIteration = true;
  });

  it('should select self iteration when inbox hides opening settings', () => {
    render(<Content />);

    expect(screen.queryByRole('button', { name: 'agentTab.opening' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'agentTab.selfIteration' })).toBeInTheDocument();
    expect(screen.getByTestId('agent-settings-menu')).toHaveAttribute(
      'data-selected',
      ChatSettingsTabs.SelfIteration,
    );
    expect(screen.getByTestId('agent-settings-content')).toHaveAttribute(
      'data-tab',
      ChatSettingsTabs.SelfIteration,
    );
  });
});
