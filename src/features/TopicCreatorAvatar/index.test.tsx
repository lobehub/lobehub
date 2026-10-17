/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicCreatorAvatar from './index';

const useAuthorInfoMock = vi.hoisted(() => vi.fn());
const hasActiveWorkspaceMock = vi.hoisted(() => ({ value: true }));

vi.mock('@/business/client/hooks/useAuthorInfo', () => ({
  useAuthorInfo: useAuthorInfoMock,
}));
vi.mock('@/business/client/hooks/useHasActiveWorkspace', () => ({
  useHasActiveWorkspace: () => hasActiveWorkspaceMock.value,
}));

// The identity-preserving wrapper owns the initials/background fallback; this
// component's contract is only what it hands over.
vi.mock('@/components/Avatar', () => ({
  default: ({
    avatar,
    name,
    shape,
    title,
  }: {
    avatar?: string;
    name?: string;
    shape?: string;
    title?: string;
  }) => (
    <span
      data-avatar={avatar ?? ''}
      data-name={name ?? ''}
      data-shape={shape ?? ''}
      data-testid="avatar"
      data-title={title ?? ''}
    />
  ),
}));

describe('TopicCreatorAvatar', () => {
  beforeEach(() => {
    hasActiveWorkspaceMock.value = true;
  });

  it('hides the bot conversation initiator in personal mode', () => {
    hasActiveWorkspaceMock.value = false;
    useAuthorInfoMock.mockReturnValue(undefined);
    const { queryByTestId } = render(
      <TopicCreatorAvatar
        botCreator={{ id: '123', platform: 'wechat', avatar: 'sender.png', fullName: 'ow' }}
        corner={<span data-testid="platform-icon" />}
        userId="owner"
      />,
    );
    expect(queryByTestId('avatar')).toBeNull();
    expect(queryByTestId('platform-icon')).toBeNull();
  });

  it('shows the bot conversation initiator instead of the workspace bot owner', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'owner.png', fullName: 'Bot owner' });
    const { getByTestId } = render(
      <TopicCreatorAvatar
        userId="owner"
        botCreator={{
          id: '123',
          platform: 'discord',
          avatar: 'sender.png',
          fullName: 'LobehubBot',
        }}
      />,
    );
    expect(getByTestId('avatar').getAttribute('data-avatar')).toBe('sender.png');
    expect(getByTestId('avatar').getAttribute('data-title')).toBe('LobehubBot');
  });

  it('uses sender initials without borrowing the owner avatar', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'owner.png', fullName: 'Bot owner' });
    const { getByTestId } = render(
      <TopicCreatorAvatar
        botCreator={{ id: '123', platform: 'discord', username: 'LobehubBot' }}
        userId="owner"
      />,
    );
    expect(getByTestId('avatar').getAttribute('data-avatar')).toBe('');
    expect(getByTestId('avatar').getAttribute('data-name')).toBe('LobehubBot');
  });

  it("renders a workspace member's round avatar (any member, including self)", () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId } = render(<TopicCreatorAvatar userId="any-member" />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith('any-member');
    const avatar = getByTestId('avatar');
    expect(avatar.getAttribute('data-avatar')).toBe('https://x/y.png');
    expect(avatar.getAttribute('data-shape')).toBe('circle');
    expect(avatar.getAttribute('data-title')).toBe('Alice');
  });

  it('passes the name so an avatar-less member falls back to their initials', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: null, fullName: 'Alice' });

    const { getByTestId } = render(<TopicCreatorAvatar userId="any-member" />);

    const avatar = getByTestId('avatar');
    expect(avatar.getAttribute('data-avatar')).toBe('');
    expect(avatar.getAttribute('data-name')).toBe('Alice');
  });

  it('keeps the avatar primary and shrinks the row icon into the corner badge', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId } = render(
      <TopicCreatorAvatar corner={<span data-testid="status-icon" />} userId="any-member" />,
    );

    // Both the full avatar and the corner-badged row icon render.
    expect(getByTestId('avatar')).toBeTruthy();
    expect(getByTestId('status-icon')).toBeTruthy();
  });

  it('renders the bare avatar when no corner node is provided', () => {
    useAuthorInfoMock.mockReturnValue({ avatar: 'https://x/y.png', fullName: 'Alice' });

    const { getByTestId, queryByTestId } = render(<TopicCreatorAvatar userId="any-member" />);

    expect(getByTestId('avatar')).toBeTruthy();
    expect(queryByTestId('status-icon')).toBeNull();
  });

  it('renders nothing in personal mode / when the creator is not a resolvable member', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(
      <TopicCreatorAvatar corner={<span data-testid="status-icon" />} userId="someone" />,
    );

    // No avatar AND no corner badge — the caller falls back to its own layout.
    expect(queryByTestId('avatar')).toBeNull();
    expect(queryByTestId('status-icon')).toBeNull();
  });

  it('renders nothing when no userId is provided (default / temp topic)', () => {
    useAuthorInfoMock.mockReturnValue(undefined);

    const { queryByTestId } = render(<TopicCreatorAvatar />);

    expect(useAuthorInfoMock).toHaveBeenCalledWith(undefined);
    expect(queryByTestId('avatar')).toBeNull();
  });
});
