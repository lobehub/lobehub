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
  useAgentDropdownMenu: () => [],
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
  default: ({ avatar, title }: { avatar: unknown; title: string }) =>
    createElement('div', {}, title, avatar as never),
}));

const conversation = (avatar?: string) =>
  ({
    activeAt: new Date('2026-11-03'),
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
});
