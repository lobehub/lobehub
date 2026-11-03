/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './Body';

const home = vi.hoisted(() => ({
  channels: [] as Record<string, unknown>[],
  channelsEnabled: true,
  channelsError: undefined as unknown,
  pathname: '/',
  query: '',
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
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: home.pathname }),
}));
vi.mock('@/store/channel', () => ({
  channelActions: {
    refreshList: () => {},
    useFetchList: () => ({ error: home.channelsError }),
  },
  channelSelectors: { list: () => home.channels },
  useChannelStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/features/Channels/useChannelsEnabled', () => ({
  useChannelsEnabled: () => home.channelsEnabled,
}));
vi.mock('@/features/Channels/useChannelEvents', () => ({ useChannelEvents: () => {} }));
vi.mock('./SearchContext', () => ({
  useMessageSearch: () => ({ query: home.query, setQuery: () => {} }),
}));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ onClick, title }: { onClick: () => void; title: string }) =>
    createElement('button', { onClick }, title),
}));
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

vi.mock('./ChannelConversation', () => ({
  default: ({ active, channel }: { active: boolean; channel: { title: string } }) =>
    createElement('div', { 'aria-current': active ? 'page' : undefined }, `# ${channel.title}`),
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({
  default: () => createElement('div', {}, 'Loading agents'),
}));
vi.mock('./InboxConversation', () => ({
  default: () => createElement('div', {}, 'Lobe AI row'),
}));
vi.mock('./AgentConversation', () => ({
  default: ({
    active,
    conversation,
  }: {
    active: boolean;
    conversation: { item: { title: string } };
  }) =>
    createElement('div', { 'aria-current': active ? 'page' : undefined }, conversation.item.title),
}));
vi.mock('./GroupConversation', () => ({ default: () => null }));

beforeEach(() => {
  home.channels = [
    {
      agentId: null,
      createdAt: new Date('2026-10-01'),
      id: 'chn_team',
      projectId: null,
      status: 'active',
      title: 'Team',
    },
  ];
  home.channelsEnabled = true;
  home.channelsError = undefined;
  home.pathname = '/';
  home.query = '';
  home.error = undefined;
  home.isInit = false;
  home.items = [];
  home.recents = [];
});

describe('MessageList Body', () => {
  it('keeps Lobe AI and Channels visible while the agent list is unresolved', () => {
    render(createElement(Body));

    expect(screen.getByText('Lobe AI row')).toBeInTheDocument();
    expect(screen.getByText('# Team')).toBeInTheDocument();
    expect(screen.getByText('Loading agents')).toBeInTheDocument();
  });

  it('replaces the agent skeleton with an error, keeping Lobe AI and Channels', () => {
    home.error = new Error('network');

    render(createElement(Body));

    expect(screen.getByText('Agents failed')).toBeInTheDocument();
    expect(screen.queryByText('Loading agents')).not.toBeInTheDocument();
    expect(screen.getByText('Lobe AI row')).toBeInTheDocument();
    expect(screen.getByText('# Team')).toBeInTheDocument();
  });

  it('drops the agent skeleton once the list arrives', () => {
    home.isInit = true;
    home.items = [
      { id: 'a', pinned: false, title: 'Agent A', type: 'agent', updatedAt: new Date() },
    ];

    render(createElement(Body));

    expect(screen.getByText('Agent A')).toBeInTheDocument();
    expect(screen.queryByText('Loading agents')).not.toBeInTheDocument();
    expect(screen.getByText('# Team')).toBeInTheDocument();
  });
});

describe('MessageList Body Channel rows', () => {
  const channel = (patch: Record<string, unknown>) => ({
    agentId: null,
    createdAt: new Date('2026-10-01'),
    projectId: null,
    status: 'active',
    ...patch,
  });

  it('lists group Channels as rows, leaving out direct, project and archived ones', () => {
    home.channels = [
      channel({ id: 'chn_team', title: 'Team' }),
      channel({ agentId: 'agt_nasa', id: 'chn_direct', title: 'Nasa' }),
      channel({ id: 'chn_project', projectId: 'pro_1', title: 'Project' }),
      channel({ id: 'chn_archived', status: 'archived', title: 'Old' }),
    ];

    render(createElement(Body));

    expect(screen.getByText('# Team')).toBeInTheDocument();
    expect(screen.queryByText('# Nasa')).not.toBeInTheDocument();
    expect(screen.queryByText('# Project')).not.toBeInTheDocument();
    expect(screen.queryByText('# Old')).not.toBeInTheDocument();
  });

  it('keeps an archived Channel listed while it is open, and highlights it', () => {
    home.pathname = '/channels/chn_archived';
    home.channels = [channel({ id: 'chn_archived', status: 'archived', title: 'Old' })];

    render(createElement(Body));

    expect(screen.getByText('# Old')).toHaveAttribute('aria-current', 'page');
  });

  // Archiving a group Channel left the IM layout with no way back to it.
  it('lists archived Channels behind the archived group at the end', () => {
    home.channels = [
      channel({ id: 'chn_team', title: 'Team' }),
      channel({ id: 'chn_archived', status: 'archived', title: 'Old' }),
    ];

    render(createElement(Body));
    expect(screen.queryByText('# Old')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('archivedGroup'));
    expect(screen.getByText('# Old')).toBeInTheDocument();
  });

  it('finds archived Channels by search', () => {
    home.query = 'old';
    home.channels = [channel({ id: 'chn_archived', status: 'archived', title: 'Old' })];

    render(createElement(Body));

    expect(screen.getByText('# Old')).toBeInTheDocument();
    expect(screen.queryByText('archivedGroup')).not.toBeInTheDocument();
  });

  it('shows no Channel rows while Channels are off', () => {
    home.channelsEnabled = false;

    render(createElement(Body));

    expect(screen.queryByText('# Team')).not.toBeInTheDocument();
  });
});

describe('MessageList Body active row', () => {
  const agent = {
    id: 'agt_nasa',
    pinned: false,
    title: 'Nasa',
    type: 'agent',
    updatedAt: new Date(),
  };

  it.each([
    ['its Agent page', '/agent/agt_nasa'],
    ['its direct Channel', '/channels/chn_000000000001'],
  ])('highlights an Agent row while %s is open', (_, pathname) => {
    home.isInit = true;
    home.items = [agent];
    home.pathname = pathname;
    home.channels = [{ agentId: 'agt_nasa', id: 'chn_000000000001' }];

    render(createElement(Body));

    expect(screen.getByText('Nasa')).toHaveAttribute('aria-current', 'page');
  });

  it('leaves Agent rows unhighlighted inside a group Channel', () => {
    home.isInit = true;
    home.items = [agent];
    home.pathname = '/channels/chn_000000000002';
    home.channels = [{ agentId: null, id: 'chn_000000000002' }];

    render(createElement(Body));

    expect(screen.getByText('Nasa')).not.toHaveAttribute('aria-current');
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
