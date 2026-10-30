'use client';

import type { DeviceExecutionTarget, DeviceListItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BoxIcon, LaptopIcon, MonitorOffIcon, SparklesIcon } from 'lucide-react';
import { memo } from 'react';

import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';

import moduleStyles from './index.module.css';

const styles = stylex.create({
  dotOffline: {
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorTextQuaternary,
    backgroundImage: 'none',
  },
  dotOnline: {
    flex: 'none',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: cssVar.colorSuccess,
    backgroundImage: 'none',
    boxShadow: `0 0 0 2px ${cssVar.colorSuccessBg}`,
  },
  status: { display: 'inline-flex', gap: '6px', alignItems: 'center' },
  option: { display: 'flex', flex: '1', gap: '8px', alignItems: 'center', minWidth: 0 },
  optionDescription: { fontSize: '12px', lineHeight: '16px', color: cssVar.colorTextDescription },
  optionIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  optionName: {
    overflow: 'hidden',
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '20px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  selectItem: { minHeight: '40px' },
  selectPopup: { maxWidth: 'calc(100vw - 24px)' },
  triggerIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    color: cssVar.colorTextSecondary,
  },
  triggerLabel: { display: 'flex', flex: '1', gap: '8px', alignItems: 'center', minWidth: 0 },
  triggerName: {
    overflow: 'hidden',
    flex: '1',
    textAlign: 'start',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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

/**
 * The devices a Task may pin.
 *
 * Narrower than {@link devicePoolForAgent} for a workspace agent: a Task's
 * scheduled and heartbeat runs execute as the task's creator, and a private
 * workspace device is only resolvable by the member who enrolled it
 * (`DeviceModel.findWorkspaceDeviceById`). A collaborator's private machine
 * pinned on a shared task is therefore unreachable for automation — and the
 * creator's private machine is unreachable for a collaborator's manual run — so
 * only public workspace devices are offered.
 */
export const devicePoolForTask = (
  devices: DeviceListItem[] | undefined,
  workspaceAgent: boolean,
): DeviceListItem[] => {
  const { personal, publicWorkspace } = groupExecutionTargetDevices(devices);

  return workspaceAgent ? publicWorkspace : personal;
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
  /**
   * Shown instead of offline for a row restored from the persisted device list
   * (`onlineUnknown`): its `online: false` is a placeholder until the server
   * confirms presence.
   */
  unknown?: boolean;
  unknownLabel: string;
}

export const ExecutionTargetDeviceStatus = memo<ExecutionTargetDeviceStatusProps>(
  ({ offlineLabel, online, onlineLabel, unknown, unknownLabel }) => (
    <span {...stylex.props(styles.status)}>
      <span
        aria-hidden
        {...stylex.props(
          unknown ? styles.dotOffline : online ? styles.dotOnline : styles.dotOffline,
        )}
      />
      <span>{unknown ? unknownLabel : online ? onlineLabel : offlineLabel}</span>
    </span>
  ),
);

ExecutionTargetDeviceStatus.displayName = 'ExecutionTargetPicker.ExecutionTargetDeviceStatus';

/** Select slots for execution-environment pickers that render {@link ExecutionTargetLabel}. */
export const executionTargetSelectClassNames = {
  item: stylex.props(styles.selectItem).className,
  popup: stylex.props(styles.selectPopup).className,
  value: moduleStyles.selectValue,
};

interface ExecutionTargetLabelProps {
  compact?: boolean;
  description: string;
  device?: DeviceListItem;
  label: string;
  offlineLabel: string;
  onlineLabel: string;
  target: DeviceExecutionTarget;
  unknownLabel: string;
}

export const ExecutionTargetLabel = memo<ExecutionTargetLabelProps>(
  ({ compact, description, device, label, offlineLabel, onlineLabel, target, unknownLabel }) => {
    const icon = <ExecutionTargetIcon devicePlatform={device?.platform} target={target} />;
    const secondary = device ? (
      <ExecutionTargetDeviceStatus
        offlineLabel={offlineLabel}
        online={device.online}
        onlineLabel={onlineLabel}
        unknown={device.onlineUnknown}
        unknownLabel={unknownLabel}
      />
    ) : (
      description
    );

    if (compact) {
      return (
        <span className={stylex.props(styles.triggerLabel).className}>
          <span aria-hidden className={stylex.props(styles.triggerIcon).className}>
            {icon}
          </span>
          <span className={stylex.props(styles.triggerName).className}>{label}</span>
          {device ? (
            <span className={stylex.props(styles.optionDescription).className}>{secondary}</span>
          ) : null}
        </span>
      );
    }

    return (
      <span className={stylex.props(styles.option).className}>
        <span aria-hidden className={stylex.props(styles.optionIcon).className}>
          {icon}
        </span>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <span className={stylex.props(styles.optionName).className}>{label}</span>
          <span className={stylex.props(styles.optionDescription).className}>{secondary}</span>
        </Flexbox>
      </span>
    );
  },
);

ExecutionTargetLabel.displayName = 'ExecutionTargetPicker.ExecutionTargetLabel';
