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
