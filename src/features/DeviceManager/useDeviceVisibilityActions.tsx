'use client';

import type { DeviceListItem } from '@lobechat/types';
import { confirmModal } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { canToggleDeviceVisibility } from './deviceCardActions';
import { useDeviceCardMutations } from './useDeviceCardMutations';

/**
 * Publish / make-private for a workspace enrollment, behind the shared
 * visibility-confirm body so the consequences copy matches agents / files.
 * The device card menu and the device detail page offer the same two actions.
 */
export const useDeviceVisibilityActions = (device: DeviceListItem) => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const { setVisibility } = useDeviceCardMutations(device.scope);

  const publish = () =>
    confirmModal({
      content: <VisibilityConfirmContent variant={'publish'} />,
      okText: t('devices.visibility.publish'),
      onOk: async () => {
        await setVisibility.mutateAsync({ deviceId: device.deviceId, visibility: 'public' });
      },
      title: t('devices.visibility.publishConfirmTitle'),
    });

  const makePrivate = () =>
    confirmModal({
      content: <VisibilityConfirmContent variant={'makePrivate'} />,
      okButtonProps: { danger: true },
      okText: tCommon('makePrivate.confirm.ok'),
      onOk: async () => {
        await setVisibility.mutateAsync({ deviceId: device.deviceId, visibility: 'private' });
      },
      title: tCommon('makePrivate.confirm.title'),
    });

  return { canToggle: canToggleDeviceVisibility(device, currentUserId), makePrivate, publish };
};
