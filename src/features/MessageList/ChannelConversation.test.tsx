/**
 * @vitest-environment happy-dom
 */
import type { ChannelListItem } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ChannelConversation from './ChannelConversation';

const store = vi.hoisted(() => ({
  project: undefined as { id: string; name: string } | undefined,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/Channels/useChannelMenu', () => ({ useChannelMenu: () => () => [] }));
vi.mock('@/store/project', () => ({
  projectListItemSelector: () => () => store.project,
  useProjectStore: (selector: () => unknown) => selector(),
}));
vi.mock('@/features/Projects/ProjectAvatar', () => ({
  default: () => createElement('span', { 'data-testid': 'project-avatar' }),
}));
vi.mock('@/features/GroupAvatar', () => ({
  default: ({ avatars }: { avatars: { seed: string }[] }) =>
    createElement('span', {
      'data-members': avatars.map((avatar) => avatar.seed).join(','),
      'data-testid': 'group-avatar',
    }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => () => {},
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ to: _to, ...rest }: { to: string }) => createElement('a', rest),
}));

const channel = (patch: Partial<ChannelListItem>) =>
  ({ id: 'chn_1', projectId: null, title: 'Marketing', ...patch }) as ChannelListItem;
const renderRow = (item: ChannelListItem) =>
  render(
    createElement(ChannelConversation, { active: false, activeAt: new Date(), channel: item }),
  );
const member = (id: string) => ({
  actorType: 'agent' as const,
  avatar: null,
  backgroundColor: null,
  id,
  name: id,
});

describe('ChannelConversation avatar', () => {
  it('pictures the members of a standalone Channel', () => {
    store.project = undefined;
    renderRow(channel({ memberAvatars: [member('agt_a'), member('agt_b')] }));
    expect(screen.getByTestId('group-avatar').dataset.members).toBe('agt_a,agt_b');
  });

  it('keeps "#" while no one else has joined', () => {
    store.project = undefined;
    renderRow(channel({ memberAvatars: [] }));
    expect(screen.queryByTestId('group-avatar')).toBeNull();
  });

  it('keeps the project logo for a project Channel', () => {
    store.project = { id: 'prj_1', name: 'Project' };
    renderRow(channel({ memberAvatars: [member('agt_a')], projectId: 'prj_1' }));
    expect(screen.getByTestId('project-avatar')).toBeTruthy();
    expect(screen.queryByTestId('group-avatar')).toBeNull();
  });
});
