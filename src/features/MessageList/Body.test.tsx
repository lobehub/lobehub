/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './Body';

const home = vi.hoisted(() => ({
  error: undefined as unknown,
  isInit: false,
  items: [] as unknown[],
  mutate: () => {},
  recents: [] as unknown[],
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => null,
}));
vi.mock('@/hooks/useActiveLocation', () => ({ useActiveLocation: () => ({ pathname: '/' }) }));
vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: () => ({ error: home.error, mutate: home.mutate }),
}));
vi.mock('@/components/AsyncError', () => ({
  default: () => createElement('div', {}, 'Agents failed'),
}));
vi.mock('@/features/AgentRoute/useResolvedAgentRouteId', () => ({
  resolveInboxAgentRouteId: (id: string) => id,
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: object) => unknown) =>
    selector({ useFetchConversationRecents: () => {} }),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { allAgents: () => home.items, isAgentListInit: () => home.isInit },
  homeRecentSelectors: { conversationRecents: () => () => home.recents },
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
  home.error = undefined;
  home.isInit = false;
  home.items = [];
  home.recents = [];
});

describe('MessageList Body', () => {
  it('keeps Lobe AI and Channels visible while the agent list is unresolved', () => {
    render(createElement(Body));

    expect(screen.getByText('Lobe AI row')).toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByText('Loading agents')).toBeInTheDocument();
  });

  it('replaces the agent skeleton with an error, keeping Lobe AI and Channels', () => {
    home.error = new Error('network');

    render(createElement(Body));

    expect(screen.getByText('Agents failed')).toBeInTheDocument();
    expect(screen.queryByText('Loading agents')).not.toBeInTheDocument();
    expect(screen.getByText('Lobe AI row')).toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
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

describe('MessageList Body ordering', () => {
  const row = (id: string, updatedAt: string) => ({
    id,
    pinned: false,
    title: id,
    type: 'agent',
    updatedAt: new Date(updatedAt),
  });
  const topic = (agentId: string, updatedAt: string) => ({
    agentId,
    icon: '',
    id: agentId + updatedAt,
    routePath: `/agent/${agentId}`,
    status: null,
    title: 'topic',
    type: 'topic',
    updatedAt: new Date(updatedAt),
  });

  it('moves Lobe AI up by its latest conversation, not its configuration time', () => {
    home.items = [row('a', '2026-10-01')];
    home.recents = [topic('inbox', '2026-10-06'), topic('a', '2026-10-03')];

    const { container } = render(createElement(Body));
    const text = container.textContent ?? '';

    expect(text).toContain('Lobe AI row');
    expect(text.indexOf('Lobe AI row')).toBeLessThan(text.indexOf('a'));
  });
});
