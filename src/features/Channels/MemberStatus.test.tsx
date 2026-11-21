/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MemberStatus } from './MemberStatus';

const { menus, openEnvironment } = vi.hoisted(() => ({
  menus: [] as any[][],
  openEnvironment: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ title }: { title?: string }) => createElement('button', {}, title),
  Button: () => null,
  // Lists the menu flat so each action can be read and clicked.
  DropdownMenu: ({ items }: { items: any[] }) => {
    menus.push(items);
    return createElement(
      'ul',
      {},
      items
        .filter((item) => item.key)
        .map((item) => createElement('li', { key: item.key, onClick: item.onClick }, item.key)),
    );
  },
  Flexbox: ({ children }: { children?: unknown }) => createElement('div', {}, children as never),
  Popover: () => null,
  Text: () => null,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => () => {},
}));
vi.mock('@/hooks/useCloseOnNavigate', () => ({ useCloseOnNavigate: () => 0 }));
vi.mock('./AgentEnvironment', () => ({ openChannelAgentEnvironment: openEnvironment }));
vi.mock('./CreateChannel', () => ({ openInviteMembers: () => {} }));
vi.mock('./FailureIndicator', () => ({ FailureIndicator: () => null }));
vi.mock('./MemberList', () => ({
  MemberList: () => null,
  StatusAvatar: () => null,
  useMemberEntries: ({ members }: { members: any[] }) =>
    members.map((member) => ({ member, name: member.name })),
}));
vi.mock('./useChannelMenu', () => ({
  useChannelMenu: () => () => [
    { key: 'rename' },
    { key: 'copyId' },
    { key: 'archive' },
    { type: 'divider' },
    { key: 'delete' },
  ],
}));

const cook = { agentId: 'agt_cook', id: 'mem_cook', name: 'Cook', status: 'active' };
const detail = (channel: Record<string, unknown> = {}, member: Record<string, unknown> = {}) =>
  ({
    channel: {
      agentId: 'agt_cook',
      canDelete: true,
      id: 'chn_cook',
      status: 'active',
      workspaceId: null,
      ...channel,
    },
    members: [{ ...cook, ...member }],
  }) as never;

const menuKeys = () => screen.getAllByRole('listitem').map((item) => item.textContent);

describe('MemberStatus in a direct conversation', () => {
  // The roster is hidden in a direct conversation, and it held the only way to set up a coding
  // Agent's device and working directory for the Channel.
  it('keeps the Agent environment setup in the menu', () => {
    render(createElement(MemberStatus, { detail: detail() }));

    expect(menuKeys()).toEqual(['openAgent', 'environment', 'copyId']);
    fireEvent.click(screen.getByText('environment'));
    expect(openEnvironment).toHaveBeenCalledWith('chn_cook', expect.objectContaining(cook));
  });

  it('offers no environment setup once the conversation is archived', () => {
    render(createElement(MemberStatus, { detail: detail({ status: 'archived' }) }));

    expect(menuKeys()).not.toContain('environment');
  });

  it('offers no environment setup when the Agent has left', () => {
    render(createElement(MemberStatus, { detail: detail({}, { status: 'removed' }) }));

    expect(menuKeys()).not.toContain('environment');
  });
});

describe('MemberStatus profile toggle', () => {
  const memberPanel = { id: 'panel', onToggle: () => {}, open: false };

  it('opens the Agent profile from a direct conversation', () => {
    render(createElement(MemberStatus, { detail: detail(), memberPanel }));

    expect(screen.getByText('profile.show')).toBeTruthy();
    expect(screen.queryByText('members.show')).toBeNull();
  });

  it('keeps the roster toggle in a group Channel', () => {
    render(createElement(MemberStatus, { detail: detail({ agentId: null }), memberPanel }));

    expect(screen.getByText('members.show')).toBeTruthy();
    expect(screen.queryByText('profile.show')).toBeNull();
  });
});

describe('MemberStatus in a group Channel', () => {
  it('sends management to the settings page instead of offering delete', () => {
    render(createElement(MemberStatus, { detail: detail({ agentId: null }) }));

    expect(menuKeys()).toEqual(['copyId', 'settings']);
  });

  it('offers no settings to a member who cannot manage the Channel', () => {
    render(createElement(MemberStatus, { detail: detail({ agentId: null, canDelete: false }) }));

    expect(menuKeys()).toEqual(['copyId']);
  });
});

describe('MemberStatus on a thread page', () => {
  // The thread page header showed the thread's `…` right beside the Channel's `…`: two identical
  // icons for two menus. The thread's actions now head the Channel's single menu.
  it('folds the thread actions into the one Channel menu', () => {
    menus.length = 0;
    render(
      createElement(MemberStatus, {
        detail: detail({ agentId: null }),
        threadMenu: [{ key: 'copyThreadLink' }, { key: 'deleteThread' }],
      }),
    );

    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(
      menus.at(-1)!.map((item) =>
        item.type === 'group'
          ? {
              [item.label]: item.children.map(
                (child: { key?: string; type?: string }) => child.key ?? child.type,
              ),
            }
          : item.type,
      ),
    ).toEqual([
      { thread: ['copyThreadLink', 'deleteThread'] },
      'divider',
      { channel: ['copyId', 'divider', 'settings'] },
    ]);
  });

  it('keeps the plain Channel menu when the thread offers no actions', () => {
    render(createElement(MemberStatus, { detail: detail({ agentId: null }), threadMenu: [] }));

    expect(menuKeys()).toEqual(['copyId', 'settings']);
  });
});
