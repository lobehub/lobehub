import type { DeviceListItem } from '@lobechat/types';
import { Button, Flexbox, Select, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import {
  isCurrentMachineDevice,
  isDeviceOffline,
  splitPickerDevices,
  useCurrentMachine,
} from '@/features/DeviceManager/devicePicker';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { OfflineDevicesToggle } from '@/features/DeviceManager/OfflineDevicesToggle';
import { openPickWorkingDirModal } from '@/features/WorkingDirectory';
import type { DeviceListResult } from '@/store/device/useDeviceList';

import { channelAgentIssueKey } from './agentEnvironment';
import type { useChannelAgentDraft } from './useChannelAgentDraft';

const styles = stylex.create({
  directory: { maxWidth: '100%', overflow: 'hidden' },
});

export const deviceLabel = (device: DeviceListItem) =>
  device.friendlyName || device.hostname || device.deviceId;

type DraftControls = ReturnType<typeof useChannelAgentDraft>;

/** Device and working directory for one Agent in one Channel. */
export const EnvironmentFields = ({
  controls: { change, changeDevice, draft, remote },
  devices,
  name,
}: {
  controls: DraftControls;
  devices: DeviceListResult;
  name: string;
}) => {
  const { t } = useTranslation(['channel', 'device']);
  const currentMachine = useCurrentMachine();
  const [showOffline, setShowOffline] = useState(false);
  // This computer first, then reachable devices; offline ones fold into one
  // group at the end unless one of them is the pick.
  const folds = (device: DeviceListItem) =>
    devices.isConfirmed && isDeviceOffline(device) && device.deviceId !== draft.deviceId;
  const { available, offline } = splitPickerDevices(devices.data ?? [], currentMachine);
  const visibleDevices = [...available, ...offline].filter((device) => !folds(device));
  const foldedDevices = offline.filter(folds);
  const deviceOption = (device: DeviceListItem) => {
    const suffix =
      !devices.isConfirmed || device.onlineUnknown
        ? t('environment.checkingDevice')
        : device.online
          ? ''
          : t('offline');
    return {
      disabled:
        !devices.isConfirmed ||
        !device.online ||
        !!device.onlineUnknown ||
        (device.scope === 'workspace' && device.visibility !== 'public'),
      label: (
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
          {getDeviceIcon(device.platform, 14)}
          <Text ellipsis>{deviceLabel(device)}</Text>
          {isCurrentMachineDevice(device, currentMachine) && (
            <Tag size={'small'} style={{ flex: 'none' }}>
              {t('picker.thisDevice', { ns: 'device' })}
            </Tag>
          )}
          {suffix && (
            <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
              {suffix}
            </Text>
          )}
        </Flexbox>
      ),
      value: device.deviceId,
    };
  };
  const missingDevice =
    draft.deviceId && !devices.data?.some((item) => item.deviceId === draft.deviceId);
  const canChooseDirectory =
    draft.deviceId &&
    devices.isConfirmed &&
    devices.data?.some(
      (item) => item.deviceId === draft.deviceId && item.online && !item.onlineUnknown,
    );

  if (remote)
    return (
      <Text fontSize={12} type="secondary">
        {t('environment.remoteHost')}
      </Text>
    );

  return (
    <>
      <Select
        aria-describedby={draft.issue ? `channel-agent-${draft.agentId}-issue` : undefined}
        aria-label={t('environment.deviceLabel', { name })}
        placeholder={t('environment.followAgent')}
        value={draft.deviceId ?? ''}
        options={[
          // No device is the default: the Agent runs where its own settings say.
          { label: t('environment.followAgent'), value: '' },
          ...(missingDevice
            ? [
                {
                  disabled: true,
                  label: t('environment.unavailableDevice'),
                  value: draft.deviceId!,
                },
              ]
            : []),
          ...visibleDevices.map(deviceOption),
          ...(foldedDevices.length > 0
            ? [
                {
                  label: (
                    <OfflineDevicesToggle
                      count={foldedDevices.length}
                      expanded={showOffline}
                      onToggle={() => setShowOffline((v) => !v)}
                    />
                  ),
                  options: showOffline ? foldedDevices.map(deviceOption) : [],
                },
              ]
            : []),
        ]}
        onChange={changeDevice}
      />
      {draft.deviceId && (
        <Button
          aria-label={t('environment.directoryLabel', { name })}
          disabled={!canChooseDirectory}
          icon={FolderOpen}
          title={draft.workingDirectory || t('chooseDirectory')}
          {...stylex.props(styles.directory)}
          onClick={() =>
            openPickWorkingDirModal({
              defaultPath: draft.workingDirectory,
              deviceId: draft.deviceId,
              onPick: ({ path }) => change({ workingDirectory: path }),
            })
          }
        >
          <Text ellipsis>{draft.workingDirectory || t('chooseDirectory')}</Text>
        </Button>
      )}
    </>
  );
};

/** Why an Agent cannot be saved yet, or that its settings are still loading. */
export const EnvironmentIssue = ({
  controls: { draft, retry, sync },
  inherited,
}: {
  controls: DraftControls;
  /** The Agent's own device and directory apply; there is nothing to pick here. */
  inherited?: boolean;
}) => {
  const { t } = useTranslation('channel');
  if (draft.issue === 'configurationFailed')
    return (
      <AsyncError
        error={sync.error}
        retrying={sync.isValidating}
        title={t('environment.configurationFailed')}
        variant="inline"
        onRetry={() => void retry()}
      />
    );
  if (!draft.issue) return null;
  const checking = draft.issue === 'configurationLoading' || draft.issue === 'devicesLoading';
  return (
    <Text
      fontSize={12}
      id={`channel-agent-${draft.agentId}-issue`}
      role="status"
      type={checking ? 'secondary' : 'danger'}
    >
      {t(channelAgentIssueKey(draft.issue, inherited))}
    </Text>
  );
};
