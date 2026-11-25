'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import OptionRow from '@/features/ChatInput/ControlBar/OptionRow';
import {
  isCurrentMachineDevice,
  splitPickerDevices,
  useCurrentMachine,
} from '@/features/DeviceManager/devicePicker';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { OfflineDevicesToggle } from '@/features/DeviceManager/OfflineDevicesToggle';
import { ExecutionTargetDeviceStatus } from '@/features/ExecutionTargetPicker';

/** A device as the dialog names it. */
export const addDirectoryDeviceName = (device?: DeviceListItem, fallback = '') =>
  device?.friendlyName || device?.hostname || device?.deviceId || fallback;

/** Whether the device is reachable now, beside its name: a dot and a word. */
export const AddDirectoryDeviceStatus = ({ device }: { device: DeviceListItem }) => {
  const { t } = useTranslation('chat');
  return (
    <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
      <ExecutionTargetDeviceStatus
        offlineLabel={t('heteroAgent.executionTarget.offline')}
        online={device.online}
        onlineLabel={t('heteroAgent.executionTarget.online')}
        unknown={device.onlineUnknown}
        unknownLabel={t('heteroAgent.executionTarget.presenceChecking')}
      />
    </Text>
  );
};

/**
 * The first step of adding an execution environment: which machine it works
 * on. Every device is one row — this computer first, then the reachable ones,
 * offline ones folded at the end like every other device picker. An offline
 * device can still be picked; its folder is then typed instead of browsed.
 */
const AddDirectoryDeviceStep = ({
  devices,
  onPick,
}: {
  devices: DeviceListItem[];
  onPick: (deviceId: string) => void;
}) => {
  const { t } = useTranslation(['device', 'project']);
  const currentMachine = useCurrentMachine();
  const [showOffline, setShowOffline] = useState(false);
  const { available, offline } = splitPickerDevices(devices, currentMachine);

  const row = (device: DeviceListItem) => (
    <OptionRow
      hint={<AddDirectoryDeviceStatus device={device} />}
      icon={getDeviceIcon(device.platform, 16)}
      key={device.deviceId}
      label={addDirectoryDeviceName(device)}
      tags={isCurrentMachineDevice(device, currentMachine) ? [t('picker.thisDevice')] : []}
      onClick={() => onPick(device.deviceId)}
    />
  );

  return (
    <Flexbox gap={2} style={{ maxHeight: 360, overflowY: 'auto' }}>
      {available.map(row)}
      {offline.length > 0 && (
        <OfflineDevicesToggle
          count={offline.length}
          expanded={showOffline}
          onToggle={() => setShowOffline((v) => !v)}
        />
      )}
      {showOffline && offline.map(row)}
      {devices.length === 0 && (
        <Text type={'secondary'}>{t('settings.noDevices', { ns: 'project' })}</Text>
      )}
    </Flexbox>
  );
};

export default AddDirectoryDeviceStep;
