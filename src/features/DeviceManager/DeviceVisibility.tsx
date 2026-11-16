'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { EyeOffIcon, GlobeIcon, LockIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { shownDeviceVisibility } from './deviceCardActions';
import { useDeviceVisibilityActions } from './useDeviceVisibilityActions';

interface DeviceVisibilityProps {
  device: DeviceListItem;
  /** Edits wait until the server confirms the row (see DeviceDetail `isConfirmed`). */
  disabled?: boolean;
}

/**
 * Who can use a workspace device, and the enroller's switch for it. A private
 * device runs only its enroller's Agents, so other members' requests on an
 * Agent bound to it never run. Lobot links here
 * (`/:slug/settings/devices/:id?visibility=private`) when that is why an
 * Agent is unavailable, so the switch sits on the page itself, not only in
 * the list card's menu.
 */
const DeviceVisibility = ({ device, disabled }: DeviceVisibilityProps) => {
  const { t } = useTranslation(['setting', 'common']);
  const { canToggle, makePrivate, publish } = useDeviceVisibilityActions(device);
  const visibility = shownDeviceVisibility(device);
  if (!visibility) return null;

  const isPrivate = visibility === 'private';
  return (
    <Flexbox horizontal align={'center'} gap={12} id={'visibility'}>
      <Icon icon={isPrivate ? LockIcon : UsersIcon} size={16} />
      <Text style={{ flex: 1, minWidth: 0 }} type={'secondary'}>
        {t(isPrivate ? 'devices.detail.visibility.private' : 'devices.detail.visibility.public')}
      </Text>
      {canToggle &&
        (isPrivate ? (
          <Button
            disabled={disabled}
            icon={<Icon icon={GlobeIcon} />}
            type={'primary'}
            onClick={publish}
          >
            {t('devices.visibility.publish')}
          </Button>
        ) : (
          <Button disabled={disabled} icon={<Icon icon={EyeOffIcon} />} onClick={makePrivate}>
            {t('makePrivate', { ns: 'common' })}
          </Button>
        ))}
    </Flexbox>
  );
};

export default DeviceVisibility;
