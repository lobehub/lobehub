'use client';

import type { HeterogeneousAgentUpdateDescriptor } from '@lobechat/heterogeneous-agents';
import type { DeviceListItem } from '@lobechat/types';
import { Button, Flexbox, Popover, Snippet, Spin, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpCircle } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceRunningSummary } from '@/features/DeviceManager/DeviceActivity/RunningUsers';
import { useCanOperateDevice } from '@/features/DeviceManager/useCanEditDevice';

import { getDeviceCommands, getNewerAgentCliVersion } from './deviceCliStatus';
import { useAgentCliLatestVersion } from './useAgentCliLatestVersion';
import { useDeviceAgentCliUpdate } from './useDeviceAgentCliUpdate';

const styles = stylex.create({
  details: {
    maxHeight: 200,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  failed: {
    color: cssVar.colorError,
    fontSize: 13,
  },
  metaText: {
    color: cssVar.colorTextSecondary,
    fontSize: 13,
  },
});

const popoverStyles = { content: { maxWidth: 'min(400px, 80vw)' } };

interface DeviceCliUpdateProps {
  agentType: string;
  device?: DeviceListItem;
  deviceId: string;
  deviceName: string;
  displayName: string;
  /** Re-scan the CLI once an update ends. */
  onFinish: () => void;
  /** Whether the device's client can update the CLI itself (absent on older clients). */
  updatable?: boolean;
  update: HeterogeneousAgentUpdateDescriptor;
  version?: string;
}

/**
 * The newer release of an agent CLI on a device, next to its version.
 *
 * A device whose client can update the CLI gets a one-click update for anyone
 * who may operate it, held back while topics run there. Older clients, and
 * callers who cannot operate the device, get the commands to run instead.
 */
export const DeviceCliUpdate = memo<DeviceCliUpdateProps>(
  ({
    agentType,
    device,
    deviceId,
    deviceName,
    displayName,
    onFinish,
    update,
    updatable,
    version,
  }) => {
    const { t } = useTranslation('setting');
    const canOperateDevice = useCanOperateDevice();

    const { data: latestVersion } = useAgentCliLatestVersion(agentType);
    const newerVersion = getNewerAgentCliVersion(version, latestVersion);
    const canUpdate = !!updatable && !!device && canOperateDevice(device);

    const { error, failed, job, start, starting } = useDeviceAgentCliUpdate({
      agentType,
      deviceId,
      enabled: canUpdate,
      onFinish,
    });
    const { data: runningSummary } = useDeviceRunningSummary(canUpdate && !!newerVersion);
    const busy = runningSummary?.some((item) => item.deviceId === deviceId && item.count > 0);

    if (job?.status === 'running') {
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Spin size="small" style={{ opacity: 0.6 }} />
          <Text {...stylex.props(styles.metaText)}>
            {t('heterogeneousStatus.update.running', { name: displayName })}
          </Text>
        </Flexbox>
      );
    }

    // The updater ran but the CLI stayed put (e.g. its release channel lags
    // npm `latest`): a second click would do the same, so say so instead.
    const upToDate =
      job?.status === 'succeeded' && !!job.version && job.version === job.fromVersion;
    const updateCommands = getDeviceCommands(update.commands, device?.platform);

    return (
      <>
        {failed && (
          <Flexbox horizontal align="center" gap={4}>
            <Text {...stylex.props(styles.failed)}>{t('heterogeneousStatus.update.failed')}</Text>
            {error && (
              <Popover
                placement={'bottomLeft'}
                styles={popoverStyles}
                trigger={'click'}
                content={
                  <Text fontSize={12} {...stylex.props(styles.details)}>
                    {error}
                  </Text>
                }
              >
                <Button size={'small'} type={'text'}>
                  {t('heterogeneousStatus.device.showDetails')}
                </Button>
              </Popover>
            )}
          </Flexbox>
        )}
        {upToDate ? (
          <Text {...stylex.props(styles.metaText)}>
            {t('heterogeneousStatus.update.upToDate', { name: displayName })}
          </Text>
        ) : (
          newerVersion &&
          (canUpdate ? (
            <Tooltip
              title={
                busy ? t('heterogeneousStatus.update.busy', { device: deviceName }) : undefined
              }
            >
              {/* A disabled button swallows hover; the wrapper keeps the reason visible. */}
              <span>
                <Button
                  disabled={busy}
                  icon={<ArrowUpCircle size={14} />}
                  loading={starting}
                  size={'small'}
                  onClick={start}
                >
                  {t('heterogeneousStatus.update.action', { version: newerVersion })}
                </Button>
              </span>
            </Tooltip>
          ) : (
            updateCommands.length > 0 && (
              <Popover
                placement={'bottomLeft'}
                styles={popoverStyles}
                trigger={'click'}
                content={
                  <Flexbox gap={8}>
                    <Text fontSize={12} type={'secondary'}>
                      {t('heterogeneousStatus.update.desc', { device: deviceName })}
                    </Text>
                    {updateCommands.map((command) => (
                      <Snippet key={command} language={'bash'}>
                        {command}
                      </Snippet>
                    ))}
                  </Flexbox>
                }
              >
                <Button icon={<ArrowUpCircle size={14} />} size={'small'} type={'text'}>
                  {t('heterogeneousStatus.update.available', { version: newerVersion })}
                </Button>
              </Popover>
            )
          ))
        )}
      </>
    );
  },
);

DeviceCliUpdate.displayName = 'DeviceCliUpdate';
