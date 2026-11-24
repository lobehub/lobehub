'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Flexbox, Icon, Select, Tag, Text } from '@lobehub/ui';
import { LaptopIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { OfflineDevicesToggle } from '@/features/DeviceManager/OfflineDevicesToggle';

import type { ScanTarget } from './useAgentScan';

/**
 * The switch's value for this computer. Not empty: the select reads an empty
 * value as no selection and would show a blank trigger.
 */
const LOCAL_TARGET_VALUE = '__local__';

const deviceLabel = (device: DeviceListItem) =>
  device.friendlyName || device.hostname || device.deviceId;

interface DeviceSwitchProps {
  /** Other devices that are online or still being checked. */
  available: DeviceListItem[];
  /** Shown to the right of the select (the rescan action). */
  extra?: ReactNode;
  localLabel: string;
  /** This computer's own row, when listed: it lends the local option its icon. */
  localRow?: DeviceListItem;
  offline: DeviceListItem[];
  onPick: (target: ScanTarget) => void;
  target: ScanTarget;
}

/** "Runs on": this computer first and tagged, other devices after, offline ones folded. */
export const DeviceSwitch = memo<DeviceSwitchProps>(
  ({ available, extra, localLabel, localRow, offline, onPick, target }) => {
    const { t } = useTranslation(['chat', 'device']);
    const [showOffline, setShowOffline] = useState(false);
    // An offline device stays visible while it is the one picked.
    const offlineExpanded =
      showOffline ||
      (target.kind === 'device' && offline.some((d) => d.deviceId === target.device.deviceId));

    const deviceOption = (device: DeviceListItem) => ({
      disabled: !device.online,
      label: (
        <Flexbox horizontal align={'center'} gap={8}>
          {getDeviceIcon(device.platform, 14)}
          <span>{deviceLabel(device)}</span>
          {!device.online && (
            <Text fontSize={12} type={'secondary'}>
              {t('connectAgent.create.offline')}
            </Text>
          )}
        </Flexbox>
      ),
      value: device.deviceId,
    });

    return (
      <Flexbox horizontal align={'center'} gap={8}>
        <Select
          aria-label={t('connectAgent.create.switchDevice')}
          popupMatchSelectWidth={false}
          style={{ flex: 1, minWidth: 0 }}
          value={target.kind === 'device' ? target.device.deviceId : LOCAL_TARGET_VALUE}
          options={[
            {
              label: (
                <Flexbox horizontal align={'center'} gap={8}>
                  {localRow ? (
                    getDeviceIcon(localRow.platform, 14)
                  ) : (
                    <Icon icon={LaptopIcon} size={14} />
                  )}
                  <span>{localLabel}</span>
                  <Tag size={'small'} style={{ flex: 'none' }}>
                    {t('picker.thisDevice', { ns: 'device' })}
                  </Tag>
                </Flexbox>
              ),
              value: LOCAL_TARGET_VALUE,
            },
            ...available.map(deviceOption),
            ...(offline.length > 0
              ? [
                  {
                    label: (
                      <OfflineDevicesToggle
                        count={offline.length}
                        expanded={offlineExpanded}
                        onToggle={() => setShowOffline((v) => !v)}
                      />
                    ),
                    options: offlineExpanded ? offline.map(deviceOption) : [],
                  },
                ]
              : []),
          ]}
          onChange={(value) => {
            if (value === LOCAL_TARGET_VALUE) return onPick({ kind: 'local' });
            const device = [...available, ...offline].find((d) => d.deviceId === value);
            if (device) onPick({ device, kind: 'device' });
          }}
        />
        {extra}
      </Flexbox>
    );
  },
);

DeviceSwitch.displayName = 'ConnectAgentDeviceSwitch';
