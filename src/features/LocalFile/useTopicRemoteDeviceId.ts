import { isDesktop } from '@lobechat/const';

import { useLocalMachineDeviceIds } from '@/hooks/useLocalMachineDeviceIds';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

/**
 * How often presence is re-read while a topic's files depend on another
 * device, so a reference turns back into a link once that device reconnects.
 * Same cadence as the topic sidebar's device presence poll.
 */
const PRESENCE_REFRESH_INTERVAL_MS = 30_000;

export interface TopicRemoteDevice {
  /**
   * Whether this client can read the current topic's local files right now:
   * over this desktop's own IPC, or through the topic's device while it is
   * online. Callers gate previews on this alone — a reference that can't be
   * read stays a plain chip instead of a link that opens an error.
   */
  canReadFiles: boolean;
  /**
   * The device to read through over RPC. `undefined` while `canReadFiles`
   * means this desktop reads the file itself over Electron IPC.
   */
  deviceId: string | undefined;
}

/**
 * Where the current topic's local files can be read from.
 *
 * A topic whose device is another machine (or any device, off desktop) is read
 * through that device's RPC, and only while it is online: the Electron IPC
 * fallback would read this machine's same path instead, which on desktop
 * opens the wrong (usually missing) file and off desktop does not exist.
 *
 * A topic that ran on this desktop — under its personal or its active
 * workspace device id — or never bound a device keeps reading through local
 * IPC. Web / mobile have nothing to read such a topic with.
 */
export const useTopicRemoteDeviceId = (): TopicRemoteDevice => {
  const topicDeviceId = useChatStore(topicSelectors.currentTopicDeviceId);
  const localDeviceIds = useLocalMachineDeviceIds();
  const remoteDeviceId =
    topicDeviceId && !(isDesktop && localDeviceIds.includes(topicDeviceId))
      ? topicDeviceId
      : undefined;
  const isLogin = useUserStore(authSelectors.isLogin);

  useDeviceStore((s) => s.useFetchDevices)(!!remoteDeviceId && isLogin, {
    refreshInterval: PRESENCE_REFRESH_INTERVAL_MS,
  });
  const isOnline = useDeviceStore(
    (s) => !!remoteDeviceId && !!deviceSelectors.getDeviceById(remoteDeviceId)(s)?.online,
  );

  if (remoteDeviceId) {
    return { canReadFiles: isOnline, deviceId: isOnline ? remoteDeviceId : undefined };
  }

  return { canReadFiles: isDesktop, deviceId: undefined };
};
