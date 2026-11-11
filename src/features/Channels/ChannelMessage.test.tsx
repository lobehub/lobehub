/**
 * @vitest-environment happy-dom
 */
import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { act, createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import EntityLinkElement from '@/features/EntityLink/element';

import { ChannelMessage } from './ChannelMessage';
import { CHANNEL_MENTION_TAG } from './mentionMarkdown';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));
vi.mock('@/features/Conversation/ChatItem', () => ({
  // Renders only the avatar and message slots, the way ChatItem hands them over.
  ChatItem: ({
    customAvatarRender,
    message,
  }: {
    customAvatarRender: (a: unknown, n: ReactNode) => ReactNode;
    message: ReactNode;
  }) =>
    createElement(
      'div',
      {},
      customAvatarRender({}, createElement('img', { alt: 'avatar' })),
      message,
    ),
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
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: ({ items }: { items: { key: string; label: string; onClick: () => void }[] }) =>
    createElement(
      'div',
      {},
      items.map((item) =>
        createElement('button', { key: item.key, onClick: item.onClick }, item.label),
      ),
    ),
}));
const collapsibleProps = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('@/components/CollapsibleContent', () => ({
  default: (props: { children: ReactNode }) => {
    collapsibleProps.current = props;
    return props.children;
  },
}));
const markdownProps = vi.hoisted(() => ({ current: undefined as any }));
vi.mock('@/features/Conversation/Markdown', () => ({
  default: (props: unknown) => {
    markdownProps.current = props;
    return null;
  },
}));
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
  channel: { agentId: null, id: 'chn_1' },
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

    // `avatar` is the message bubble's default image, which falls back to the legacy default.
    expect(screen.queryByAltText('avatar')).toBeNull();
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

describe('ChannelMessage links', () => {
  it('renders links through the entity-link element, alongside mention chips', () => {
    render(
      <ChannelMessage
        detail={detail}
        message={{
          ...message({ avatar: null, id: 'agt_1', name: 'Sanjo', type: 'agent' }),
          content: 'https://github.com/lobehub/lobehub/pull/22581',
        }}
      />,
    );

    expect(markdownProps.current.components[EntityLinkElement.tag]).toBe(
      EntityLinkElement.Component,
    );
    expect(markdownProps.current.components[CHANNEL_MENTION_TAG]).toBeDefined();
    expect(markdownProps.current.rehypePlugins).toContain(EntityLinkElement.rehypePlugin);
  });
});

describe('ChannelMessage collapse', () => {
  const longMessage = {
    ...message({ avatar: null, id: 'agt_1', name: 'Sanjo', type: 'agent' }),
    content: 'A long reply',
  };

  it('shows a long message in full and only offers collapsing from the more menu', () => {
    render(<ChannelMessage detail={detail} message={longMessage} />);

    expect(collapsibleProps.current.collapsed).toBe(false);
    expect(collapsibleProps.current.hideCollapseToggle).toBe(true);
    expect(screen.queryByText('message.collapse')).toBeNull();

    act(() => collapsibleProps.current.onOverflowChange(true));
    fireEvent.click(screen.getByText('message.collapse'));

    expect(collapsibleProps.current.collapsed).toBe(true);
    expect(screen.getByText('message.expand')).toBeTruthy();
  });
});
