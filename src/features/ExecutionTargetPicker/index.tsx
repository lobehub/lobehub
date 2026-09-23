'use client';

import type { DeviceExecutionTarget, DeviceListItem } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BoxIcon, LaptopIcon, MonitorOffIcon, SparklesIcon } from 'lucide-react';
import { memo } from 'react';

import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';

const styles = createStaticStyles(({ css }) => ({
  dotOffline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorTextQuaternary};
  `,
  dotOnline: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
    box-shadow: 0 0 0 2px ${cssVar.colorSuccessBg};
  `,
  status: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
  `,
}));

export const SHARED_EXECUTION_TARGETS = ['auto', 'device', 'none', 'sandbox'] as const;

export const isSharedExecutionTarget = (
  target: DeviceExecutionTarget | undefined,
): target is Exclude<DeviceExecutionTarget, 'local'> =>
  !!target &&
  SHARED_EXECUTION_TARGETS.includes(target as (typeof SHARED_EXECUTION_TARGETS)[number]);

export const executionTargetValue = (target: DeviceExecutionTarget, deviceId?: string) =>
  target === 'device' && deviceId ? `device:${deviceId}` : `target:${target}`;

export const parseExecutionTargetValue = (
  value: string,
): { deviceId?: string; target: DeviceExecutionTarget } | undefined => {
  if (value.startsWith('device:')) {
    const deviceId = value.slice('device:'.length);
    return deviceId ? { deviceId, target: 'device' } : undefined;
  }

  if (!value.startsWith('target:')) return undefined;
  const target = value.slice('target:'.length) as DeviceExecutionTarget;
  return ['auto', 'local', 'none', 'sandbox'].includes(target) ? { target } : undefined;
};

export interface ExecutionTargetSelection {
  deviceId?: string;
  target: DeviceExecutionTarget;
}

/**
 * Resolve the execution target an agent currently points at.
 *
 * Shared by the Agent Profile picker (which renders it) and the Permission page
 * (which can only fix a target that actually resolves) so the two surfaces
 * cannot disagree about what "no environment picked yet" means. A `device`
 * target whose bound device is gone — unshared, deleted, still loading —
 * resolves to `undefined` rather than a dangling selection.
 */
export const resolveExecutionTargetSelection = ({
  boundDeviceId,
  configuredTarget,
  devices,
  isHeterogeneous,
}: {
  boundDeviceId?: string;
  configuredTarget?: DeviceExecutionTarget;
  devices: DeviceListItem[];
  isHeterogeneous: boolean;
}): ExecutionTargetSelection | undefined => {
  if (configuredTarget === 'device') {
    const boundDevice = devices.find((device) => device.deviceId === boundDeviceId);
    return boundDevice ? { deviceId: boundDevice.deviceId, target: 'device' } : undefined;
  }

  if (isSharedExecutionTarget(configuredTarget)) return { target: configuredTarget };

  // Built-in-runtime agents default to "no environment" when nothing is stored;
  // heterogeneous ones genuinely have no selection until the author picks one.
  return configuredTarget === undefined && !isHeterogeneous ? { target: 'none' } : undefined;
};

export const groupExecutionTargetDevices = (devices: DeviceListItem[] | undefined) => ({
  personal: (devices ?? []).filter((device) => device.scope === 'personal'),
  privateWorkspace: (devices ?? []).filter(
    (device) => device.scope === 'workspace' && device.visibility === 'private',
  ),
  publicWorkspace: (devices ?? []).filter(
    (device) => device.scope === 'workspace' && device.visibility === 'public',
  ),
  workspace: (devices ?? []).filter(
    (device) => device.scope === 'workspace' && device.visibility !== 'private',
  ),
});

/**
 * The devices an agent's runs can actually reach.
 *
 * A deviceId encodes the identity it was enrolled under
 * (`sha256(machineUUID + userId)` for personal, `… + workspace:<id>` for
 * workspace), so the two pools are not interchangeable: a workspace agent
 * cannot resolve a personal machine, nor a personal agent a workspace one.
 * Offering the other pool would let a user pin a machine the run can never use
 * — and a Task makes that worse than a chat, because its scheduled runs execute
 * under the workspace principal rather than whoever is looking at it.
 *
 * Order is the picker's: the workspace pool lists private rows before public
 * ones, the personal pool is flat.
 */
export const devicePoolForAgent = (
  devices: DeviceListItem[] | undefined,
  workspaceAgent: boolean,
): DeviceListItem[] => {
  const { personal, privateWorkspace, workspace } = groupExecutionTargetDevices(devices);

  return workspaceAgent ? [...privateWorkspace, ...workspace] : personal;
};

interface ExecutionTargetIconProps {
  devicePlatform?: string | null;
  size?: number;
  target: DeviceExecutionTarget;
}

export const ExecutionTargetIcon = memo<ExecutionTargetIconProps>(
  ({ devicePlatform, size = 14, target }) => {
    switch (target) {
      case 'auto': {
        return <Icon icon={SparklesIcon} size={size} />;
      }
      case 'device': {
        return <>{getDeviceIcon(devicePlatform, size)}</>;
      }
      case 'local': {
        return <Icon icon={LaptopIcon} size={size} />;
      }
      case 'none': {
        return <Icon icon={MonitorOffIcon} size={size} />;
      }
      case 'sandbox': {
        return <Icon icon={BoxIcon} size={size} />;
      }
    }
  },
);

ExecutionTargetIcon.displayName = 'ExecutionTargetPicker.ExecutionTargetIcon';

interface ExecutionTargetDeviceStatusProps {
  offlineLabel: string;
  online: boolean;
  onlineLabel: string;
}

export const ExecutionTargetDeviceStatus = memo<ExecutionTargetDeviceStatusProps>(
  ({ offlineLabel, online, onlineLabel }) => (
    <span className={styles.status}>
      <span aria-hidden className={online ? styles.dotOnline : styles.dotOffline} />
      <span>{online ? onlineLabel : offlineLabel}</span>
    </span>
  ),
);

ExecutionTargetDeviceStatus.displayName = 'ExecutionTargetPicker.ExecutionTargetDeviceStatus';
