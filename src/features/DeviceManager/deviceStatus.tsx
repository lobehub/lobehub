'use client';

import { isDesktop } from '@lobechat/const';
import { type BinaryStatus } from '@lobechat/electron-client-ipc';
import type { DeviceListItem } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceAgentScan } from '@/features/DeviceManager/useDeviceAgentScan';
import { useLocalHeteroAgentStatus } from '@/features/DeviceManager/useLocalHeteroAgentStatus';

export const deviceStatusStyles = createStaticStyles(({ css }) => ({
  dotAvailable: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
  `,
  dotUnavailable: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorError};
  `,
  dotOffline: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotOutdated: css`
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorWarning};
  `,
  tabLabel: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
  `,
  tabLabelName: css`
    overflow: hidden;
    max-width: 160px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tabLabelSuffix: css`
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export interface DeviceStatusSource {
  agentType: string;
  currentDeviceId?: string;
  /** The device under inspection; `undefined` means the current machine. */
  device?: DeviceListItem;
  /** Whether the local detection is still in flight. */
  localDetecting?: boolean;
  /** Local (Electron IPC) detection result — reused for the current machine. */
  localStatus?: BinaryStatus;
}

/**
 * Shared per-device CLI status derivation used by the status card header.
 *
 * The current machine is probed over Electron IPC (path detail the gateway
 * scan lacks); any other device is probed through the gateway; offline devices
 * are never probed. `device === undefined` resolves to the current machine —
 * on desktop that means the IPC probe, on web there is no local CLI at all.
 */
export const useDeviceStatus = ({
  agentType,
  currentDeviceId,
  device,
  localDetecting,
  localStatus,
}: DeviceStatusSource) => {
  const isCurrentMachine = device ? device.deviceId === currentDeviceId : isDesktop;

  const scan = useDeviceAgentScan(
    !isCurrentMachine && device?.online ? device.deviceId : undefined,
    agentType,
  );

  const checking = isCurrentMachine ? localDetecting === true : scan.isLoading;
  const available = isCurrentMachine
    ? localStatus?.available === true
    : scan.data?.available === true;
  const version = isCurrentMachine ? localStatus?.version : scan.data?.version;
  const path = isCurrentMachine ? localStatus?.path : undefined;
  // The device answered the scan but the type is missing from its map — its
  // client is too old to know the agent → ask the user to update the device
  // client, not "install the CLI".
  const outdated = !isCurrentMachine && scan.scanned && scan.data === undefined;
  // `available: false` in the map is the device's explicit verdict: the CLI is
  // not installed there. A failed probe (offline, client without the scan
  // tool) stays "unknown" rather than "not installed".
  const notInstalled = isCurrentMachine
    ? localStatus !== undefined && !localStatus.available
    : scan.scanned && scan.data?.available === false;

  return {
    available,
    checking,
    isCurrentMachine,
    notInstalled,
    offline: device ? !device.online : false,
    outdated,
    path,
    version,
  };
};

export interface DeviceStatusDotProps {
  agentType: string;
  /** Resolved launch command — used for the current machine's IPC probe. */
  command?: string;
  currentDeviceId?: string;
  /** The device to inspect; `undefined` = the current machine. */
  device?: DeviceListItem;
}

/**
 * Status dot for one device: green = CLI installed, red = not installed,
 * amber = device client too old to know the type, gray = offline or the probe
 * itself failed, spinner = probing. The current machine is probed over
 * Electron IPC (fast, gateway-free); any other device through the gateway.
 */
export const DeviceStatusDot = memo<DeviceStatusDotProps>(
  ({ agentType, command, currentDeviceId, device }) => {
    const isCurrentMachine = device ? device.deviceId === currentDeviceId : isDesktop;

    const local = useLocalHeteroAgentStatus(
      isCurrentMachine ? agentType : undefined,
      isCurrentMachine ? command : undefined,
    );
    const scan = useDeviceAgentScan(
      !isCurrentMachine && device?.online ? device.deviceId : undefined,
      agentType,
    );

    if (isCurrentMachine) {
      if (local.detecting) {
        return <Icon spin icon={Loader2Icon} size={12} style={{ opacity: 0.6 }} />;
      }
      const dotClass = local.status?.available
        ? deviceStatusStyles.dotAvailable
        : local.status !== undefined
          ? deviceStatusStyles.dotUnavailable
          : deviceStatusStyles.dotOffline;
      return <span aria-hidden className={dotClass} />;
    }

    if (scan.isLoading) {
      return <Icon spin icon={Loader2Icon} size={12} style={{ opacity: 0.6 }} />;
    }

    // The device answered the scan: green when the CLI is there, red when it
    // explicitly reported not installed, amber when the client is too old to
    // know the type. Gray = offline or the probe itself failed.
    const dotClass = scan.scanned
      ? scan.data?.available
        ? deviceStatusStyles.dotAvailable
        : scan.data !== undefined
          ? deviceStatusStyles.dotUnavailable
          : deviceStatusStyles.dotOutdated
      : deviceStatusStyles.dotOffline;
    return <span aria-hidden className={dotClass} />;
  },
);

DeviceStatusDot.displayName = 'HeterogeneousAgentDeviceTabs.DeviceStatusDot';

interface DeviceTabLabelProps extends DeviceStatusDotProps {}

/**
 * Tab label of the device switch row in the agent profile: status dot +
 * device name, with a "This device" marker on the current machine. `device`
 * omitted renders the fixed local-machine tab. The whole status card below
 * the tabs switches along with it.
 */
export const DeviceTabLabel = memo<DeviceTabLabelProps>(
  ({ agentType, command, currentDeviceId, device }) => {
    const { t } = useTranslation('setting');
    const isCurrentMachine = device ? device.deviceId === currentDeviceId : isDesktop;

    return (
      <span className={deviceStatusStyles.tabLabel}>
        <DeviceStatusDot
          agentType={agentType}
          command={command}
          currentDeviceId={currentDeviceId}
          device={device}
        />
        <span className={deviceStatusStyles.tabLabelName}>
          {device
            ? device.friendlyName || device.hostname || device.deviceId
            : t('heterogeneousStatus.devices.thisDevice')}
        </span>
        {isCurrentMachine && device ? (
          <span className={deviceStatusStyles.tabLabelSuffix}>
            {t('heterogeneousStatus.devices.thisDevice')}
          </span>
        ) : null}
      </span>
    );
  },
);

DeviceTabLabel.displayName = 'HeterogeneousAgentDeviceTabs.DeviceTabLabel';
