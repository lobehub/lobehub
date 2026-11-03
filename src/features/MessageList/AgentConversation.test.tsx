/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AgentConversation from './AgentConversation';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/AgentAvatar', () => ({
  default: ({ agentId, avatar }: { agentId: string; avatar?: string }) =>
    createElement('span', { 'data-testid': 'agent-avatar' }, `${agentId}:${avatar ?? 'generated'}`),
}));
vi.mock('@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu', () => ({
  // An Agent's own menu ends with its Delete; the row must not clash with it.
  useAgentDropdownMenu: () => () => [{ key: 'delete', label: 'delete' }],
}));
vi.mock('@/features/Channels/useChannelMenu', () => ({
  useChannelMenu: () => (channel: { status?: string }) => [
    { key: 'copyId', label: 'copyId' },
    channel.status === 'archived'
      ? { key: 'unarchive', label: 'unarchive' }
      : { key: 'archive', label: 'archive' },
    { type: 'divider' },
    { key: 'delete', label: 'moveToTrash' },
  ],
}));
vi.mock('@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl', () => ({
  usePreservedAgentUrl: (id: string) => `/agent/${id}`,
}));
vi.mock('@/features/HomeSidebar/Body/Agent/ModalProvider', () => ({
  useAgentModal: () => ({ openCreateGroupModal: () => {} }),
}));
vi.mock('@/hooks/usePrefetchAgent', () => ({ usePrefetchAgent: () => () => {} }));
vi.mock('@/store/chat', () => ({ useChatStore: () => false }));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: { isAgentVisiblyRunning: () => () => false },
}));
vi.mock('./useAgentConversationLink', () => ({
  useAgentConversationLink: (_: string, url: string) => ({ url }),
}));
vi.mock('./ConversationRow', () => ({
  default: ({ avatar, contextMenuItems, title }: any) =>
    createElement(
      'div',
      {},
      title,
      avatar as never,
      createElement(
        'span',
        { 'data-testid': 'menu' },
        (contextMenuItems?.() ?? []).map((item: any) => item.key ?? item.type).join(','),
      ),
    ),
}));

const conversation = (avatar?: string, channel?: { status?: string }) =>
  ({
    activeAt: new Date('2026-11-03'),
    ...(channel ? { channel: { id: 'cht_cook', title: 'Cook', unreadCount: 0, ...channel } } : {}),
    item: { avatar, id: 'agt_cook', name: 'Cook', title: 'Cook', type: 'agent' },
  }) as never;

describe('AgentConversation avatar', () => {
  // The row drew the legacy robot image while the agent's Channel showed its generated character.
  it('draws the agent avatar seeded by its id when it has no image of its own', () => {
    render(createElement(AgentConversation, { active: false, conversation: conversation() }));

    expect(screen.getByTestId('agent-avatar')).toHaveTextContent('agt_cook:generated');
  });

  it('keeps an agent’s own image or emoji', () => {
    render(createElement(AgentConversation, { active: false, conversation: conversation('🍳') }));

    expect(screen.getByTestId('agent-avatar')).toHaveTextContent('agt_cook:🍳');
  });

  // A row that opens a direct Channel is that conversation, so its archive / trash live here.
  it('offers the direct Channel archive and trash actions beside the Agent menu', () => {
    render(
      createElement(AgentConversation, {
        active: false,
        conversation: conversation(undefined, {}),
      }),
    );

    expect(screen.getByTestId('menu')).toHaveTextContent('delete,divider,channel-archive,channel-delete');
  });

  it('offers unarchive instead for an archived direct Channel', () => {
    render(
      createElement(AgentConversation, {
        active: false,
        conversation: conversation(undefined, { status: 'archived' }),
      }),
    );

    expect(screen.getByTestId('menu')).toHaveTextContent('channel-unarchive');
  });

  it('keeps the Agent menu alone when the row opens no Channel', () => {
    render(createElement(AgentConversation, { active: false, conversation: conversation() }));

    expect(screen.getByTestId('menu')).toHaveTextContent('delete');
    expect(screen.getByTestId('menu')).not.toHaveTextContent('channel-');
  });
});
