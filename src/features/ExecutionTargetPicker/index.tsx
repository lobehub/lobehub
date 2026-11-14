'use client';

import type { DeviceExecutionTarget, DeviceListItem } from '@lobechat/types';
import { createStaticStyles, cssVar, Flexbox, Icon } from '@lobehub/ui';
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
  option: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  optionDescription: css`
    font-size: 12px;
    line-height: 16px;
    color: ${cssVar.colorTextDescription};
  `,
  optionIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
  `,
  optionName: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  selectItem: css`
    min-height: 40px;
  `,
  selectPopup: css`
    max-width: calc(100vw - 24px);
  `,
  selectValue: css`
    > span {
      display: flex;
      flex: 1;
      min-width: 0;
    }
  `,
  triggerIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;

    color: ${cssVar.colorTextSecondary};
  `,
  triggerLabel: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  triggerName: css`
    overflow: hidden;
    flex: 1;

    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
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

/**
 * The devices a Task may pin.
 *
 * A Task's scheduled runs execute as its creator, and a private workspace
 * device resolves only for the member who enrolled it
 * (`DeviceModel.findWorkspaceDeviceById`). The private rows in a device list
 * are only ever the caller's own, so they are pinnable exactly when the caller
 * is the task's creator (`includeOwnPrivate`) — creating it, or editing their
 * own task. A collaborator editing someone else's task gets the public pool
 * only: their private machine is one the creator's runs can never reach.
 */
export const devicePoolForTask = (
  devices: DeviceListItem[] | undefined,
  workspaceAgent: boolean,
  { includeOwnPrivate }: { includeOwnPrivate: boolean },
): DeviceListItem[] => {
  if (!workspaceAgent || includeOwnPrivate) return devicePoolForAgent(devices, workspaceAgent);

  return groupExecutionTargetDevices(devices).publicWorkspace;
};

/**
 * This machine's private row in the workspace pool, if it has one — the row
 * auto-enrollment creates. `localMachineIds` are the ids this desktop holds
 * (`useLocalMachineDeviceIds`); only the workspace one can match. A row shared
 * as public is a team device: picking it is a shared binding, so it never
 * stands in for "this machine".
 */
export const findOwnWorkspaceDevice = (
  devices: DeviceListItem[] | undefined,
  localMachineIds: string[],
): DeviceListItem | undefined =>
  devices?.find(
    (device) =>
      device.scope === 'workspace' &&
      device.visibility === 'private' &&
      localMachineIds.includes(device.deviceId),
  );

/**
 * The target a desktop picker writes on its own, or `undefined` to leave the
 * agent alone.
 *
 * - Nothing stored yet: this machine — its workspace row through the gateway
 *   when it has one, else the in-app `local` path.
 * - The member's own plain `local` pick on a workspace agent whose machine now
 *   has a workspace row moves to that row, so runs go through the gateway. A
 *   sandboxed `local` stays: only the in-app path can fence commands. A shared
 *   `local` the member merely inherits (`isOwnPick: false`) is not theirs to move.
 */
export const getMachineDefaultTarget = ({
  boundDeviceId,
  executionTarget,
  isOwnPick,
  localSandboxEnabled,
  ownWorkspaceDeviceId,
}: {
  boundDeviceId?: string;
  executionTarget?: DeviceExecutionTarget;
  isOwnPick: boolean;
  localSandboxEnabled: boolean;
  ownWorkspaceDeviceId?: string;
}): ExecutionTargetSelection | undefined => {
  if (executionTarget === undefined && boundDeviceId === undefined) {
    return ownWorkspaceDeviceId
      ? { deviceId: ownWorkspaceDeviceId, target: 'device' }
      : { target: 'local' };
  }

  if (executionTarget === 'local' && isOwnPick && !localSandboxEnabled && ownWorkspaceDeviceId)
    return { deviceId: ownWorkspaceDeviceId, target: 'device' };

  return undefined;
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
    <span className={styles.status}>
      <span
        aria-hidden
        className={unknown ? styles.dotOffline : online ? styles.dotOnline : styles.dotOffline}
      />
      <span>{unknown ? unknownLabel : online ? onlineLabel : offlineLabel}</span>
    </span>
  ),
);

ExecutionTargetDeviceStatus.displayName = 'ExecutionTargetPicker.ExecutionTargetDeviceStatus';

/** Select slots for execution-environment pickers that render {@link ExecutionTargetLabel}. */
export const executionTargetSelectClassNames = {
  item: styles.selectItem,
  popup: styles.selectPopup,
  value: styles.selectValue,
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
        <span className={styles.triggerLabel}>
          <span aria-hidden className={styles.triggerIcon}>
            {icon}
          </span>
          <span className={styles.triggerName}>{label}</span>
          {device ? <span className={styles.optionDescription}>{secondary}</span> : null}
        </span>
      );
    }

    return (
      <span className={styles.option}>
        <span aria-hidden className={styles.optionIcon}>
          {icon}
        </span>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <span className={styles.optionName}>{label}</span>
          <span className={styles.optionDescription}>{secondary}</span>
        </Flexbox>
      </span>
    );
  },
);

ExecutionTargetLabel.displayName = 'ExecutionTargetPicker.ExecutionTargetLabel';
