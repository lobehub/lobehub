import type { DeviceListItem } from '@lobechat/types';
import { Button, Select, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { openPickWorkingDirModal } from '@/features/WorkingDirectory';
import type { DeviceListResult } from '@/store/device/useDeviceList';

import type { ChannelAgentIssue } from './agentEnvironment';
import type { useChannelAgentDraft } from './useChannelAgentDraft';

const styles = stylex.create({
  directory: { maxWidth: '100%', overflow: 'hidden' },
});

/** Device issues of an inherited environment are fixed in the Agent's settings, not here. */
const INHERITED_ISSUES = ['deviceOffline', 'deviceRequired', 'deviceUnavailable'] as const;

const isInheritedIssue = (issue: ChannelAgentIssue): issue is (typeof INHERITED_ISSUES)[number] =>
  (INHERITED_ISSUES as readonly ChannelAgentIssue[]).includes(issue);

export const deviceLabel = (device: DeviceListItem) =>
  device.friendlyName || device.hostname || device.deviceId;

type DraftControls = ReturnType<typeof useChannelAgentDraft>;

/** Device and working directory for one Agent in one Channel. */
export const EnvironmentFields = ({
  controls: { change, changeDevice, draft, requiresDevice },
  devices,
  name,
}: {
  controls: DraftControls;
  devices: DeviceListResult;
  name: string;
}) => {
  const { t } = useTranslation('channel');
  const missingDevice =
    draft.deviceId && !devices.data?.some((item) => item.deviceId === draft.deviceId);
  const canChooseDirectory =
    draft.deviceId &&
    devices.isConfirmed &&
    devices.data?.some(
      (item) => item.deviceId === draft.deviceId && item.online && !item.onlineUnknown,
    );

  return (
    <>
      <Select
        aria-describedby={draft.issue ? `channel-agent-${draft.agentId}-issue` : undefined}
        aria-label={t('environment.deviceLabel', { name })}
        placeholder={t(requiresDevice ? 'environment.chooseDevice' : 'noDevice')}
        value={draft.deviceId ?? ''}
        options={[
          ...(!requiresDevice ? [{ label: t('noDevice'), value: '' }] : []),
          ...(missingDevice
            ? [
                {
                  disabled: true,
                  label: t('environment.unavailableDevice'),
                  value: draft.deviceId!,
                },
              ]
            : []),
          ...(devices.data ?? []).map((device) => ({
            disabled:
              !devices.isConfirmed ||
              !device.online ||
              !!device.onlineUnknown ||
              (device.scope === 'workspace' && device.visibility !== 'public'),
            label: `${deviceLabel(device)}${!devices.isConfirmed || device.onlineUnknown ? ` · ${t('environment.checkingDevice')}` : device.online ? '' : ` · ${t('offline')}`}`,
            value: device.deviceId,
          })),
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
      {inherited && isInheritedIssue(draft.issue)
        ? t(`environment.inherited.${draft.issue}`)
        : t(`environment.${draft.issue}`)}
    </Text>
  );
};
