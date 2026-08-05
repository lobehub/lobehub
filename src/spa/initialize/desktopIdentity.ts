import type { DesktopBootstrapIdentity } from '@lobechat/electron-client-ipc';

import { useUserStore } from '@/store/user';
import type { LobeUser } from '@/types/user';

export const applyDesktopBootstrapIdentity = (
  identity:
    DesktopBootstrapIdentity | undefined = window.electronAPI?.getDesktopBootstrapIdentity?.(),
): void => {
  if (!identity) return;

  const state = useUserStore.getState();
  const nextUser = identity.userId
    ? state.user?.id === identity.userId
      ? state.user
      : ({ id: identity.userId } as LobeUser)
    : identity.isIdentityResolved
      ? undefined
      : state.user;

  useUserStore.setState({
    isIdentityResolved: identity.isIdentityResolved,
    isLoaded: true,
    isSignedIn: identity.isIdentityResolved ? Boolean(identity.userId) : state.isSignedIn,
    user: nextUser,
  });
};
