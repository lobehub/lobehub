/**
 * @vitest-environment happy-dom
 */
import type { ChannelDetail, ChannelPublicMessage, ExternalWorkSummaryItem } from '@lobechat/types';
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

describe('ChannelMessage works', () => {
  const url = 'https://github.com/lobehub/lobehub/pull/1';
  const work = {
    description: 'Adds the cards',
    event: {
      cumulativeCost: 0.42,
      cumulativeUsage: null,
      metadata: { baseBranch: 'canary', headBranch: 'feat/cards' },
    },
    id: url,
    identifier: 'lobehub/lobehub#1',
    resourceDeleted: false,
    resourceType: 'github_pull_request',
    status: 'open',
    title: 'Show works in channels',
    totalCost: 0.42,
    type: 'external',
    url,
  } as unknown as ExternalWorkSummaryItem;

  it('shows a reply’s external Works as cards that open their link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <ChannelMessage
        detail={detail}
        message={{
          ...message({ avatar: null, id: 'agt_1', name: 'Sanjo', type: 'agent' }),
          content: 'Opened it',
          works: [work],
        }}
      />,
    );

    expect(screen.getByText('Show works in channels')).toBeTruthy();
    expect(screen.getByText('lobehub/lobehub#1')).toBeTruthy();
    expect(screen.getByText('feat/cards')).toBeTruthy();
    expect(screen.getByText('0.42')).toBeTruthy();

    fireEvent.click(screen.getByText('Show works in channels'));
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('renders no cards without Works', () => {
    render(
      <ChannelMessage
        detail={detail}
        message={{
          ...message({ avatar: null, id: 'agt_1', name: 'Sanjo', type: 'agent' }),
          works: [],
        }}
      />,
    );

    expect(screen.queryByText('Show works in channels')).toBeNull();
  });
});

describe('ChannelMessage thread card', () => {
  const root = { ...message({ avatar: null, id: 'user-other', name: 'Ann', type: 'user' }) };
  const withThread = (thread: Record<string, unknown>) =>
    ({
      ...detail,
      threads: [{ followerMemberIds: [], id: 'cht_1', rootMessageId: root.id, ...thread }],
    }) as unknown as ChannelDetail;

  it('shows the thread title, reply count and latest reply, and opens the thread', () => {
    const onOpenThread = vi.fn();
    render(
      <ChannelMessage
        message={{ ...root, content: 'Topic header is unclickable\nmore detail' }}
        detail={withThread({
          lastReply: {
            author: { avatar: null, id: 'agt_1', name: 'Nasa', type: 'agent' },
            content: 'PR is up\nsecond line',
            createdAt: new Date(),
            id: 'msg_2',
          },
          replyCount: 5,
        })}
        onOpenThread={onOpenThread}
      />,
    );

    expect(screen.getByText('Topic header is unclickable')).toBeTruthy();
    expect(screen.getByText('threadCard.messages')).toBeTruthy();
    // The sidebar's thread glyph, not a branch, leads the title row only.
    const card = screen.getByRole('button', { name: /Topic header is unclickable/ });
    const [titleRow, replyRow] = card.children;
    expect(titleRow.firstElementChild?.querySelector('.lucide-corner-down-right')).not.toBeNull();
    expect(replyRow.querySelector('.lucide-corner-down-right')).toBeNull();
    expect(card.querySelector('.lucide-git-branch')).toBeNull();
    expect(screen.getByText('Nasa')).toBeTruthy();
    expect(screen.getByText('PR is up')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Topic header is unclickable/ }));
    expect(onOpenThread).toHaveBeenCalledWith('cht_1');
  });

  it('shows the viewer’s own latest reply with their live avatar', () => {
    render(
      <ChannelMessage
        message={root}
        detail={withThread({
          lastReply: {
            author: { avatar: null, id: 'user-self', name: 'Me', type: 'user' },
            content: 'On it',
            createdAt: new Date(),
            id: 'msg_3',
          },
          replyCount: 1,
        })}
      />,
    );

    expect(screen.getByText('me')).toBeTruthy();
  });

  it('names the card after the title an Agent gave the thread', () => {
    render(
      <ChannelMessage
        detail={withThread({ replyCount: 1, title: 'Header click fix' })}
        message={{ ...root, content: 'Topic header is unclickable' }}
      />,
    );

    expect(screen.getByText('Header click fix')).toBeTruthy();
  });

  it('still offers the thread when a cached view has no summary', () => {
    render(<ChannelMessage detail={withThread({})} message={root} />);

    expect(screen.getByText('thread')).toBeTruthy();
    expect(screen.getByText('openThread')).toBeTruthy();
    // A cached view without a reply row still shows the glyph in front of the title.
    expect(
      screen.getByRole('button', { name: /openThread/ }).querySelector('.lucide-corner-down-right'),
    ).not.toBeNull();
    expect(screen.queryByText('threadCard.messages')).toBeNull();
  });
});
