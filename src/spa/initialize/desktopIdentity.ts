import type { DesktopBootstrapIdentity } from '@lobechat/electron-client-ipc';

import { useUserStore } from '@/store/user';
import { readUserDisplaySnapshot, userFromDisplaySnapshot } from '@/store/user/displaySnapshot';
import type { LobeUser } from '@/types/user';

export const applyDesktopBootstrapIdentity = (
  identity:
    DesktopBootstrapIdentity | undefined = window.electronAPI?.getDesktopBootstrapIdentity?.(),
): void => {
  if (!identity) return;

  const state = useUserStore.getState();
  const isKnownUser = !!identity.userId && state.user?.id === identity.userId;
  const snapshot =
    identity.userId && !isKnownUser ? readUserDisplaySnapshot(identity.userId) : undefined;

  const nextUser = identity.userId
    ? isKnownUser
      ? state.user
      : userFromDisplaySnapshot(snapshot, { id: identity.userId } as LobeUser)
    : identity.isIdentityResolved
      ? undefined
      : state.user;

  useUserStore.setState({
    isIdentityResolved: identity.isIdentityResolved,
    isLoaded: true,
    isSignedIn: identity.isIdentityResolved ? Boolean(identity.userId) : state.isSignedIn,
    user: nextUser,
    ...(snapshot?.preference && { preference: snapshot.preference }),
    ...(snapshot?.settings && { settings: snapshot.settings }),
  });
};
