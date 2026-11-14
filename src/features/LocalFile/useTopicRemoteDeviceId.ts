import { isDesktop } from '@lobechat/const';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * The device that can serve local-file reads for the current topic when this
 * client has no filesystem of its own (web / mobile SPA).
 *
 * Returns the topic's device id only while that device is online, so callers
 * can gate previews on it: a preview without a `deviceId` would fall back to
 * the Electron IPC transport, which does not exist off desktop and fails
 * silently.
 *
 * Desktop always gets `undefined` and keeps reading through local IPC.
 */
export const useTopicRemoteDeviceId = (): string | undefined => {
  const topicDeviceId = useChatStore(topicSelectors.currentTopicDeviceId);
  const remoteDeviceId = isDesktop ? undefined : topicDeviceId;
  const isLogin = useUserStore(authSelectors.isLogin);

  useDeviceStore((s) => s.useFetchDevices)(!!remoteDeviceId && isLogin);
  const isOnline = useDeviceStore(
    (s) => !!remoteDeviceId && !!deviceSelectors.getDeviceById(remoteDeviceId)(s)?.online,
  );

  return isOnline ? remoteDeviceId : undefined;
};
