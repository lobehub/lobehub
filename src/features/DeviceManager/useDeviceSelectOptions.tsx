'use client';

import type { DeviceListItem } from '@lobechat/types';
import type { SelectOptions } from '@lobehub/ui';
import { Flexbox, Tag, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isCurrentMachineDevice, splitPickerDevices, useCurrentMachine } from './devicePicker';
import { getDeviceIcon } from './getDeviceIcon';
import { OfflineDevicesToggle } from './OfflineDevicesToggle';

/**
 * Select options for a plain device field, laid out like every other device
 * picker: this computer first and tagged, then reachable devices, offline ones
 * folded into a group at the end unless one of them is `selectedId`.
 */
export const useDeviceSelectOptions = (
  devices: DeviceListItem[],
  selectedId?: string,
): SelectOptions => {
  const { t } = useTranslation(['device', 'chat']);
  const currentMachine = useCurrentMachine();
  const [showOffline, setShowOffline] = useState(false);

  const { available, offline } = splitPickerDevices(devices, currentMachine);
  const folded = offline.filter((device) => device.deviceId !== selectedId);
  const visible = [...available, ...offline.filter((device) => device.deviceId === selectedId)];

  const option = (device: DeviceListItem) => ({
    label: (
      <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
        {getDeviceIcon(device.platform, 14)}
        <Text ellipsis>{device.friendlyName || device.hostname || device.deviceId}</Text>
        {isCurrentMachineDevice(device, currentMachine) && (
          <Tag size={'small'} style={{ flex: 'none' }}>
            {t('picker.thisDevice')}
          </Tag>
        )}
        {!device.online && !device.onlineUnknown && (
          <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
            {t('heteroAgent.executionTarget.offline', { ns: 'chat' })}
          </Text>
        )}
      </Flexbox>
    ),
    value: device.deviceId,
  });

  return [
    ...visible.map(option),
    ...(folded.length > 0
      ? [
          {
            label: (
              <OfflineDevicesToggle
                count={folded.length}
                expanded={showOffline}
                onToggle={() => setShowOffline((v) => !v)}
              />
            ),
            options: showOffline ? folded.map(option) : [],
          },
        ]
      : []),
  ];
};
