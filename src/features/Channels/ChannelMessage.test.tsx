/**
 * @vitest-environment happy-dom
 */
import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChannelMessage } from './ChannelMessage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));
vi.mock('@/features/Conversation/ChatItem', () => ({
  // Renders only the avatar slot, the way ChatItem hands it to customAvatarRender.
  ChatItem: ({
    customAvatarRender,
  }: {
    customAvatarRender: (a: unknown, n: ReactNode) => ReactNode;
  }) => createElement('div', {}, customAvatarRender({}, createElement('img', { alt: 'avatar' }))),
}));
vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({
    agentId,
    agent,
    children,
    trigger,
  }: {
    agent?: { description?: string };
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
        'data-trigger': trigger,
      },
      children,
    ),
}));
vi.mock('@/features/Conversation/Markdown', () => ({ default: () => null }));
vi.mock('@/features/User/UserAvatar', () => ({ default: () => createElement('i', {}, 'me') }));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  userProfileSelectors: { userId: () => 'user-self' },
}));
vi.mock('./MessageAttachments', () => ({ MessageAttachments: () => null }));
vi.mock('./MessageReceipts', () => ({
  MessageFailureMark: () => null,
  MessageRoutingStatus: () => null,
}));

const detail = {
  attachments: [],
  jobs: [],
  members: [{ agentId: 'agt_1', description: 'Architect', id: 'mem_1' }],
  threads: [],
} as unknown as ChannelDetail;

const message = (author: ChannelPublicMessage['author']) =>
  ({
    author,
    content: '',
    createdAt: new Date('2026-11-07T10:18:00Z'),
    fileIds: [],
    id: 'msg_1',
    mentions: [],
    routingStatus: author.type === 'agent' ? 'reply' : 'routed',
  }) as unknown as ChannelPublicMessage;

describe('ChannelMessage avatar', () => {
  it('shows the Agent profile card when hovering an Agent author', () => {
    render(
      <ChannelMessage
        detail={detail}
        message={message({ avatar: null, id: 'agt_1', name: 'Sanjo', type: 'agent' })}
      />,
    );

    const popup = screen.getByTestId('agent-profile-popup');
    expect(popup.dataset.agentId).toBe('agt_1');
    expect(popup.dataset.trigger).toBe('hover');
    expect(popup.dataset.description).toBe('Architect');
  });

  it('keeps a plain avatar for a human author', () => {
    render(
      <ChannelMessage
        detail={detail}
        message={message({ avatar: null, id: 'user-other', name: 'Ann', type: 'user' })}
      />,
    );

    expect(screen.queryByTestId('agent-profile-popup')).toBeNull();
    expect(screen.getByAltText('avatar')).toBeTruthy();
  });
});
