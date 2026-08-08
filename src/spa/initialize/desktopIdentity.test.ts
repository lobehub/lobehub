/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { applyDesktopBootstrapIdentity } from './desktopIdentity';

describe('applyDesktopBootstrapIdentity', () => {
  beforeEach(() => {
    delete window.electronAPI;
    useUserStore.setState({
      isIdentityResolved: undefined,
      isLoaded: undefined,
      isSignedIn: undefined,
      user: undefined,
    });
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
