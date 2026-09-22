'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Block, Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckIcon, ChevronDownIcon, FolderIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLockedControlTooltip } from '@/features/ChatInput/utils/lockedControlTooltip';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';

import { taskExecutionStyles as styles } from './taskExecutionStyles';
import { deviceLabel, useTaskRunTarget } from './useTaskRunTarget';

interface TaskDeviceChipProps {
  /** The assignee whose execution environment is inherited when nothing is pinned. */
  agentId: string;
  /**
   * Row class for the trigger. Omitted → the composer's compact chip; the task
   * detail's header row passes its own chip-sized class instead.
   */
  className?: string;
  /**
   * The directory the run will use, rendered as a muted line inside the popover.
   * The directory axis is only choosable for some targets, so for the rest the
   * state has to be legible HERE — next to the target that determines it —
   * instead of nowhere.
   */
  directoryHint?: string;
  disabled?: boolean;
  /** Pinned device, or `undefined` to inherit the assignee agent's target. */
  onChange: (deviceId: string | undefined) => void;
  value?: string;
}

/**
 * Where a task's runs execute.
 *
 * Deliberately NOT a copy of the composer's five-option execution-target
 * picker: the run contract can only express "pin this machine"
 * (`requestedDeviceId` forces device routing), and has no way to force the
 * cloud sandbox over an agent's stored target. So the two honest choices are
 * "inherit the agent" and "pin a device" — offering "Cloud Sandbox" as a third
 * row would be a control that silently does nothing whenever the agent's own
 * target is a device.
 *
 * The machines are listed flat. There are at most a handful, they are all the
 * same kind of thing, and the grouping our chat picker needs (personal vs the
 * workspace pool, where a workspace agent's list is *filtered* by group) has no
 * counterpart here — a task pins a specific machine the user can see.
 */
const TaskDeviceChip = memo<TaskDeviceChipProps>(
  ({ agentId, className, directoryHint, disabled, onChange, value }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);

    const { canSelect, devices, inheritedLabel, inheritedTarget, isPending } = useTaskRunTarget(
      agentId,
      value,
    );

    // The agent's policy is author-controlled: the server's resolver would drop
    // this pin, so the control must not pretend it can set one.
    const isLocked = disabled || isPending || !canSelect;

    const pinned = value ? devices?.find((device) => device.deviceId === value) : undefined;
    const unknownLabel = t('heteroAgent.executionTarget.unknownDevice');
    const isInheriting = !value;

    const handleSelect = useCallback(
      (deviceId: string | undefined) => {
        if (isLocked) return;
        onChange(deviceId);
        setOpen(false);
      },
      [isLocked, onChange],
    );

    const renderDeviceRow = (device: DeviceListItem) => {
      const isActive = device.deviceId === value;
      return (
        <Flexbox
          horizontal
          align={'center'}
          className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
          gap={8}
          key={device.deviceId}
          onClick={() => handleSelect(device.deviceId)}
        >
          <ExecutionTargetIcon devicePlatform={device.platform} target={'device'} />
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <div className={styles.rowTitle}>{deviceLabel(device, unknownLabel)}</div>
            <div className={styles.rowDesc}>
              <ExecutionTargetDeviceStatus
                offlineLabel={t('heteroAgent.executionTarget.offline')}
                online={device.online}
                onlineLabel={t('heteroAgent.executionTarget.online')}
              />
            </div>
          </Flexbox>
          {isActive && <Icon className={styles.check} icon={CheckIcon} size={14} />}
        </Flexbox>
      );
    };

    const content = (
      <Flexbox gap={4} style={{ minWidth: 280 }}>
        <div className={styles.sectionTitle}>{t('taskExecution.runLocation')}</div>
        <Flexbox
          horizontal
          align={'center'}
          className={`${styles.row} ${isInheriting ? styles.rowActive : ''}`}
          gap={8}
          onClick={() => handleSelect(undefined)}
        >
          <ExecutionTargetIcon target={inheritedTarget} />
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <div className={styles.rowTitle}>{t('taskExecution.followAgent')}</div>
            <div className={styles.rowDesc}>
              {`${t('taskExecution.followAgentDesc')} · ${inheritedLabel}`}
            </div>
          </Flexbox>
          {isInheriting && <Icon className={styles.check} icon={CheckIcon} size={14} />}
        </Flexbox>

        {isPending && (
          <div className={styles.sectionTitle}>{t('heteroAgent.executionTarget.loading')}</div>
        )}
        {!isPending && devices && devices.length > 0 && (
          <div className={styles.scroll}>{devices.map(renderDeviceRow)}</div>
        )}
        {!isPending && devices?.length === 0 && (
          <div className={styles.emptyHint}>{t('heteroAgent.executionTarget.noDevices')}</div>
        )}

        {directoryHint && (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.hint}
            gap={4}
            style={{ paddingBlock: 6 }}
          >
            <Icon icon={FolderIcon} size={12} />
            <span>{t('taskExecution.workingDirectory')}</span>
            <span className={styles.hintValue}>· {directoryHint}</span>
          </Flexbox>
        )}
      </Flexbox>
    );

    const chip = (
      <Block
        clickable
        horizontal
        align="center"
        className={cx(className ?? styles.chip, isLocked && styles.triggerDisabled)}
        gap={6}
        variant={'borderless'}
      >
        {pinned ? (
          <ExecutionTargetIcon devicePlatform={pinned.platform} target={'device'} />
        ) : (
          <ExecutionTargetIcon target={inheritedTarget} />
        )}
        <Text ellipsis className={styles.chipLabel} fontSize={12}>
          {pinned ? deviceLabel(pinned, unknownLabel) : inheritedLabel}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} />
      </Block>
    );

    if (isLocked) {
      return (
        <Tooltip
          title={formatLockedControlTooltip(
            t('taskExecution.runLocation'),
            t('taskExecution.fixedTip'),
          )}
        >
          {chip}
        </Tooltip>
      );
    }

    return (
      <Popover
        content={content}
        open={open}
        placement="bottomLeft"
        styles={{ content: { padding: 4 } }}
        trigger="click"
        onOpenChange={setOpen}
      >
        {chip}
      </Popover>
    );
  },
);

TaskDeviceChip.displayName = 'TaskDeviceChip';

export default TaskDeviceChip;
