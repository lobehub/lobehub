/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './Body';

const home = vi.hoisted(() => ({ isInit: false, items: [] as unknown[] }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => ({ pathname: '/' }) }));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: () => {} }));
vi.mock('@/features/AgentRoute/useResolvedAgentRouteId', () => ({
  resolveInboxAgentRouteId: (id: string) => id,
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) =>
    selector({ useFetchAllRecents: () => {} }),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { allAgents: () => home.items, isAgentListInit: () => home.isInit },
  homeRecentSelectors: { query: () => () => [] },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: object) => unknown) => selector({ agentMap: {} }),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { getAgentMetaById: () => () => ({ title: 'Lobe AI' }) },
  builtinAgentSelectors: { inboxAgentId: () => 'inbox' },
}));

vi.mock('@/features/Channels/ChannelList', () => ({
  default: () => createElement('div', {}, 'Channels'),
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => createElement('div', {}, 'Loading agents'),
}));
vi.mock('./InboxConversation', () => ({
  default: () => createElement('div', {}, 'Lobe AI row'),
}));
vi.mock('./AgentConversation', () => ({
  default: ({ conversation }: { conversation: { item: { title: string } } }) =>
    createElement('div', {}, conversation.item.title),
}));
vi.mock('./GroupConversation', () => ({ default: () => null }));

beforeEach(() => {
  home.isInit = false;
  home.items = [];
});

describe('MessageList Body', () => {
  it('keeps Lobe AI and Channels visible while the agent list is unresolved', () => {
    render(createElement(Body));

    expect(screen.getByText('Lobe AI row')).toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText('Loading agents')).toBeInTheDocument();
  });

  it('drops the agent skeleton once the list arrives', () => {
    home.isInit = true;
    home.items = [
      { id: 'a', pinned: false, title: 'Agent A', type: 'agent', updatedAt: new Date() },
    ];

    render(createElement(Body));

    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.queryByText('Loading agents')).not.toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
  });
});
