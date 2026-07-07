import { render, screen } from '@testing-library/react';
import type * as Antd from 'antd';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentBreadcrumb from './index';

const mocks = vi.hoisted(() => ({
  activeWorkspaceSlug: null as string | null,
  agentState: {
    agents: {
      'agent-1': { title: 'Test Agent' },
      'inbox': { title: '' },
    },
    inboxAgentId: 'inbox',
  },
}));

vi.mock('@lobehub/ui', () => ({
  Icon: () => <span />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof Antd>();

  return {
    ...actual,
    Breadcrumb: ({ items }: { items: Array<{ title: ReactNode }> }) => (
      <nav>
        {items.map((item, index) => (
          <span key={index}>{item.title}</span>
        ))}
      </nav>
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'inbox.title' ? 'Lobe AI' : key),
  }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => mocks.activeWorkspaceSlug,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    getAgentMetaById: (agentId: string) => (state: typeof mocks.agentState) =>
      state.agents[agentId as keyof typeof state.agents] ?? {},
  },
  builtinAgentSelectors: {
    inboxAgentId: (state: typeof mocks.agentState) => state.inboxAgentId,
  },
}));

describe('AgentBreadcrumb', () => {
  beforeEach(() => {
    mocks.activeWorkspaceSlug = null;
  });

  it('links the agent crumb back to the agent chat page', () => {
    render(
      <MemoryRouter initialEntries={['/agent/agent-1/profile']}>
        <AgentBreadcrumb agentId="agent-1" title="Agent Profile" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Test Agent' })).toHaveAttribute(
      'href',
      '/agent/agent-1',
    );
  });

  it('keeps the active workspace route when returning from a workspace profile route', () => {
    mocks.activeWorkspaceSlug = 'team';

    render(
      <MemoryRouter initialEntries={['/team/agent/agent-1/profile']}>
        <AgentBreadcrumb agentId="agent-1" title="Agent Profile" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Test Agent' })).toHaveAttribute(
      'href',
      '/team/agent/agent-1',
    );
  });

  it('lets the router basename restore the debug proxy prefix for workspace links', () => {
    mocks.activeWorkspaceSlug = 'team';

    render(
      <MemoryRouter
        basename="/_dangerous_local_dev_proxy"
        initialEntries={['/_dangerous_local_dev_proxy/team/agent/agent-1/profile']}
      >
        <AgentBreadcrumb agentId="agent-1" title="Agent Profile" />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Test Agent' })).toHaveAttribute(
      'href',
      '/_dangerous_local_dev_proxy/team/agent/agent-1',
    );
  });
});
