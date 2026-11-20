/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { useUserStore } from '@/store/user';
import { writeUserDisplaySnapshot } from '@/store/user/displaySnapshot';

import { applyDesktopBootstrapIdentity } from './desktopIdentity';

describe('applyDesktopBootstrapIdentity', () => {
  beforeEach(() => {
    delete window.electronAPI;
    localStorage.clear();
    useUserStore.setState({
      isIdentityResolved: undefined,
      isLoaded: undefined,
      isSignedIn: undefined,
      preference: DEFAULT_PREFERENCE,
      settings: {},
      user: undefined,
    });
  });

  it("restores the signed-in user's saved profile and settings before the network answers", () => {
    writeUserDisplaySnapshot('user-1', {
      avatar: 'avatar-1',
      fullName: 'Ada',
      preference: { lab: { enableProjects: true } },
      settings: { general: { fontSize: 15 } },
      username: 'ada',
    });

    applyDesktopBootstrapIdentity({ isIdentityResolved: true, userId: 'user-1' });

    expect(useUserStore.getState()).toMatchObject({
      isSignedIn: true,
      preference: { lab: { enableProjects: true } },
      settings: { general: { fontSize: 15 } },
      user: { avatar: 'avatar-1', fullName: 'Ada', id: 'user-1', username: 'ada' },
    });
    expect(useUserStore.getState().isUserStateInit).toBe(false);
  });

  it("never restores another user's saved profile", () => {
    writeUserDisplaySnapshot('user-2', {
      fullName: 'Other',
      settings: { general: { fontSize: 20 } },
    });

    applyDesktopBootstrapIdentity({ isIdentityResolved: true, userId: 'user-1' });

    expect(useUserStore.getState().user).toEqual({ id: 'user-1' });
    expect(useUserStore.getState().settings).toEqual({});
  });

  it('selects the signed-in cache identity before full user state is loaded', () => {
    applyDesktopBootstrapIdentity({ isIdentityResolved: true, userId: 'user-1' });

    expect(useUserStore.getState()).toMatchObject({
      isIdentityResolved: true,
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'user-1' },
    });
    expect(useUserStore.getState().isUserStateInit).toBe(false);
  });

  it('clears the previous user when safe storage resolves signed-out', () => {
    useUserStore.setState({ isSignedIn: true, user: { id: 'old-user' } as any });

    applyDesktopBootstrapIdentity({ isIdentityResolved: true });

    expect(useUserStore.getState()).toMatchObject({
      isIdentityResolved: true,
      isSignedIn: false,
      user: undefined,
    });
  });

  it('reads the identity through the preload bridge by default', () => {
    const getDesktopBootstrapIdentity = vi.fn(() => ({
      isIdentityResolved: true,
      userId: 'bridge-user',
    }));
    window.electronAPI = {
      getDesktopBootstrapIdentity,
      onStreamInvoke: vi.fn(),
    };

    applyDesktopBootstrapIdentity();

    expect(getDesktopBootstrapIdentity).toHaveBeenCalledOnce();
    expect(useUserStore.getState().user?.id).toBe('bridge-user');
  });
});
