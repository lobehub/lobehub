import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import UserUpdater from './UserUpdater';

const useSessionMock = vi.hoisted(() => vi.fn());

vi.mock('@/libs/better-auth/auth-client', () => ({
  useSession: useSessionMock,
}));

const sampleSession = (overrides?: Record<string, unknown>) => ({
  data: {
    user: {
      id: 'u1',
      email: 'a@b.com',
      name: 'Alice',
      username: 'alice',
      ...overrides,
    },
  },
  isPending: false,
  error: null,
});

describe('UserUpdater', () => {
  beforeEach(() => {
    useSessionMock.mockReset();
    useUserStore.setState({ user: undefined, isSignedIn: false, isLoaded: false });
  });

  afterEach(() => {
    useUserStore.setState({ user: undefined, isSignedIn: false, isLoaded: false });
  });

  it('preserves user fields populated by useInitUserState (e.g. interests) when better-auth re-emits the session on tab focus', () => {
    // Simulate the post-init state: useInitUserState has loaded interests etc.
    useUserStore.setState({
      user: {
        id: 'u1',
        email: 'a@b.com',
        fullName: 'Alice',
        username: 'alice',
        interests: ['内容创作', '编程'],
        firstName: 'A',
        latestName: 'lice',
      },
    });

    useSessionMock.mockReturnValue(sampleSession());
    const { rerender } = render(<UserUpdater />);

    expect(useUserStore.getState().user?.interests).toEqual(['内容创作', '编程']);
    expect(useUserStore.getState().user?.firstName).toBe('A');

    // Simulate better-auth refetching on visibilitychange: same logical user,
    // but `data` (and therefore `user`) is a fresh object reference.
    useSessionMock.mockReturnValue(sampleSession());
    rerender(<UserUpdater />);

    // Regression: interests / firstName / latestName must NOT be wiped by the
    // session sync. (LOBE-8597 — wiped interests caused the home daily-brief
    // recommendation SWR key to reset and refetch with empty interestKeys.)
    expect(useUserStore.getState().user?.interests).toEqual(['内容创作', '编程']);
    expect(useUserStore.getState().user?.firstName).toBe('A');
    expect(useUserStore.getState().user?.latestName).toBe('lice');
  });

  it('drops the previous user profile fields when the session switches to a different account', () => {
    // Simulate user A is signed in with profile fields populated.
    useUserStore.setState({
      user: {
        id: 'userA',
        email: 'a@b.com',
        fullName: 'Alice',
        username: 'alice',
        avatar: 'avatar-a',
        interests: ['内容创作', '编程'],
        firstName: 'A',
        latestName: 'lice',
      },
    });

    // Better-Auth refetch returns a different account directly (e.g. another
    // tab signed in as user B with the same cookie jar). No intermediate
    // signed-out state here.
    useSessionMock.mockReturnValue(
      sampleSession({ id: 'userB', email: 'b@c.com', name: 'Bob', username: 'bob' }),
    );
    render(<UserUpdater />);

    // Profile fields tied to user A must NOT leak to user B's store entry.
    const user = useUserStore.getState().user;
    expect(user?.id).toBe('userB');
    expect(user?.email).toBe('b@c.com');
    expect(user?.interests).toBeUndefined();
    expect(user?.firstName).toBeUndefined();
    expect(user?.latestName).toBeUndefined();
    expect(user?.avatar).toBe('');
  });

  it('clears the user when the session goes away', () => {
    useUserStore.setState({
      user: { id: 'u1', email: 'a@b.com', interests: ['x'] },
    });

    useSessionMock.mockReturnValue({ data: null, isPending: false, error: null });
    render(<UserUpdater />);

    expect(useUserStore.getState().user).toBeUndefined();
  });
});
