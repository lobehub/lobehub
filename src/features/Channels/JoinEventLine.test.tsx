/**
 * @vitest-environment happy-dom
 */
import type { ChannelPublicMember } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { JoinEventLine } from './JoinEventLine';

vi.mock('react-i18next', () => ({
  Trans: ({ components }: { components: { members: ReactElement } }) => components.members,
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: () => 'user-1' },
}));
vi.mock('./MemberAvatar', () => ({ MemberAvatar: () => null }));
vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({
    agent,
    agentId,
    children,
    trigger,
  }: {
    agent?: { description?: string; title?: string };
    agentId: string;
    children: ReactNode;
    trigger?: string;
  }) =>
    createElement(
      'div',
      {
        'data-agent-id': agentId,
        'data-description': agent?.description,
        'data-testid': 'agent-profile-popup',
        'data-title': agent?.title,
        'data-trigger': trigger,
      },
      children,
    ),
}));

const member = (overrides: Partial<ChannelPublicMember>) =>
  ({ joinedAt: new Date(0), role: 'member', ...overrides }) as ChannelPublicMember;

describe('JoinEventLine', () => {
  it('shows the hover profile card only for Agent members', () => {
    render(
      <JoinEventLine
        event={{
          at: 0,
          id: 'join:a',
          members: [
            member({
              actorType: 'agent',
              agentId: 'agent-1',
              description: 'Writes code',
              id: 'a',
              name: 'Coco',
            }),
            member({ actorType: 'user', id: 'b', userId: 'user-2', userName: 'Ming' }),
          ],
        }}
      />,
    );

    const popups = screen.getAllByTestId('agent-profile-popup');
    expect(popups).toHaveLength(1);
    expect(popups[0].dataset).toMatchObject({
      agentId: 'agent-1',
      description: 'Writes code',
      title: 'Coco',
      trigger: 'hover',
    });
    expect(popups[0].textContent).toBe('Coco');
    expect(screen.getByText('Ming').closest('[data-testid="agent-profile-popup"]')).toBeNull();
  });
});
