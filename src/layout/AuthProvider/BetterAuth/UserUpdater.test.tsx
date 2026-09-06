import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';
import { writeUserDisplaySnapshot } from '@/store/user/displaySnapshot';

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
    localStorage.clear();
    useSessionMock.mockReset();
    useUserStore.setState({ user: undefined, isSignedIn: false, isLoaded: false });
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    useUserStore.setState({ user: undefined, isSignedIn: false, isLoaded: false });
  });

  it('restores the authenticated user avatar and project preference before user-state returns', () => {
    writeUserDisplaySnapshot('u1', {
      avatar: '/cached-avatar.webp',
      preference: { lab: { enableProjects: true } },
    });
    useSessionMock.mockReturnValue(sampleSession());
    render(<UserUpdater />);

    expect(useUserStore.getState().user?.avatar).toBe('/cached-avatar.webp');
    expect(useUserStore.getState().preference.lab?.enableProjects).toBe(true);
    expect(useUserStore.getState().isSignedIn).toBe(true);
  });

  it('does not restore another user display snapshot or authenticate from a cache entry', () => {
    writeUserDisplaySnapshot('u1', {
      avatar: '/private-avatar.webp',
      preference: { lab: { enableProjects: true } },
    });
    useSessionMock.mockReturnValue({ data: null, error: null, isPending: true });
    const { unmount } = render(<UserUpdater />);
    expect(useUserStore.getState().isSignedIn).toBe(false);
    expect(useUserStore.getState().user).toBeUndefined();
    unmount();

    useSessionMock.mockReturnValue(sampleSession({ id: 'u2' }));
    render(<UserUpdater />);
    expect(useUserStore.getState().user?.avatar).toBe('');
    expect(useUserStore.getState().preference.lab?.enableProjects).not.toBe(true);
  });

  it('retries a transient cold-start session failure without confirming sign-out', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn().mockResolvedValue(undefined);
    useSessionMock.mockReturnValue({
      data: null,
      error: { status: 503 },
      isPending: false,
      refetch,
    });
    const { unmount } = render(<UserUpdater />);

    expect(useUserStore.getState().isLoaded).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('preserves the verified user while a session refresh fails temporarily', () => {
    vi.useFakeTimers();
    useUserStore.setState({
      user: { id: 'u1', avatar: '/custom.webp' },
      isSignedIn: true,
      isLoaded: true,
    });
    useSessionMock.mockReturnValue({
      data: null,
      error: { status: 503 },
      isPending: false,
      refetch: vi.fn(),
    });
    const { unmount } = render(<UserUpdater />);

    expect(useUserStore.getState().isSignedIn).toBe(true);
    expect(useUserStore.getState().user?.avatar).toBe('/custom.webp');
    unmount();
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
    // session sync. (— wiped interests caused the home daily-brief
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
    expect(useUserStore.getState().isSignedIn).toBe(false);
    expect(useUserStore.getState().isLoaded).toBe(true);
  });

  it('clears a rejected session without retrying an unauthorized response', async () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    useUserStore.setState({ user: { id: 'u1' }, isSignedIn: true, isLoaded: true });
    useSessionMock.mockReturnValue({
      data: null,
      error: { status: 401 },
      isPending: false,
      refetch,
    });
    const { unmount } = render(<UserUpdater />);

    expect(useUserStore.getState().user).toBeUndefined();
    expect(useUserStore.getState().isSignedIn).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refetch).not.toHaveBeenCalled();
    unmount();
  });
});
