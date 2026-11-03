import { DEFAULT_USER_AVATAR, isDesktop } from '@lobechat/const';
import { useMemo } from 'react';

import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export const useUserAvatar = () => {
  const avatar = useUserStore(userProfileSelectors.userAvatar) || DEFAULT_USER_AVATAR;
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);

  return useMemo(() => {
    // only process avatar in desktop environment and when avatar url starts with /
    if (!isDesktop || !remoteServerUrl || !avatar || !avatar.startsWith('/')) return avatar;

    return remoteServerUrl + avatar;
  }, [avatar, remoteServerUrl]);
};
