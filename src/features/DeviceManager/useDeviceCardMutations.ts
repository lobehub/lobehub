import type { DeviceListItem } from '@lobechat/types';
import { toast } from '@lobehub/ui';

import { lambdaQuery } from '@/libs/trpc/client';

import { refreshDeviceList } from './const';
import { getDeviceActionErrorMessage } from './deviceActionError';

/**
 * Remove / visibility mutations behind the device card's confirm modals.
 *
 * The confirm modal stays open on a rejected `onOk` but shows nothing, so
 * every mutation behind one must surface its own failure (e.g. a device still
 * pinned by a workspace agent can be neither hidden nor removed).
 */
export const useDeviceCardMutations = (scope: DeviceListItem['scope']) => {
  const onError = (error: unknown) => toast.error(getDeviceActionErrorMessage(error));
  const onSuccess = () => refreshDeviceList();

  // Workspace devices are self-or-owner-gated + workspace-scoped on the
  // server; personal devices stay userId-scoped. Route by the device's own
  // scope.
  const removePersonal = lambdaQuery.device.removeDevice.useMutation({ onError, onSuccess });
  const removeWorkspace = lambdaQuery.device.removeWorkspaceDevice.useMutation({
    onError,
    onSuccess,
  });
  // Success feedback is the row itself moving to the other tab after the list
  // refresh.
  const setVisibility = lambdaQuery.device.setWorkspaceDeviceVisibility.useMutation({
    onError,
    onSuccess,
  });

  return {
    removeDevice: scope === 'workspace' ? removeWorkspace : removePersonal,
    setVisibility,
  };
};
