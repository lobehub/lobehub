/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MemberStatus } from './MemberStatus';

const { openEnvironment } = vi.hoisted(() => ({ openEnvironment: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ title }: { title?: string }) => createElement('button', {}, title),
  Button: () => null,
  // Lists the menu flat so each action can be read and clicked.
  DropdownMenu: ({ items }: { items: any[] }) =>
    createElement(
      'ul',
      {},
      items
        .filter((item) => item.key)
        .map((item) => createElement('li', { key: item.key, onClick: item.onClick }, item.key)),
    ),
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

    expect(menuKeys()).toEqual(['openAgent', 'environment', 'copyId', 'archive', 'delete']);
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
