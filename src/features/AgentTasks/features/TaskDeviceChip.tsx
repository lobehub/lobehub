'use client';

import type { DeviceListItem } from '@lobechat/types';
import { Block, cx, Flexbox, Icon, Popover, Switch, Text, Tooltip } from '@lobehub/ui';
import { CheckIcon, ChevronDownIcon, FolderIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLockedControlTooltip } from '@/features/ChatInput/utils/lockedControlTooltip';
import { ExecutionTargetDeviceStatus, ExecutionTargetIcon } from '@/features/ExecutionTargetPicker';

import { taskExecutionStyles as styles } from './taskExecutionStyles';
import TaskPickerOption from './TaskPickerOption';
import { deviceLabel, getTaskDeviceLockReason, useTaskRunTarget } from './useTaskRunTarget';

interface TaskDeviceChipProps {
  /** The assignee whose execution environment is inherited when nothing is pinned. */
  agentId: string;
  /**
   * Row class for the trigger. Omitted → the composer's compact chip; the task
   * detail's header row passes its own chip-sized class instead.
   */
  className?: string;
  disabled?: boolean;
  /**
   * The directory the agent's own environment starts in, shown under the switch
   * while the task follows it — "follow" has to read as a concrete machine and
   * folder, not a black box.
   */
  followDirectory?: string;
  /** The task inherits the agent's device AND directory; nothing is picked here. */
  following: boolean;
  /** Pinned device, or `undefined` to run on the assignee agent's own target. */
  onChange: (deviceId: string | undefined) => void;
  onFollowChange: (following: boolean) => void;
  value?: string;
}

/**
 * The task's execution environment: follow the assignee agent, or pick a
 * machine of its own.
 *
 * Following is one switch for both axes, because the agent's environment IS a
 * machine plus a folder on it — following one and picking the other was two
 * controls for a single decision. While the switch is on there is nothing to
 * pick; turning it off lists the machines here, and the caller shows the
 * directory control next to this chip.
 *
 * Deliberately NOT a copy of the composer's five-option execution-target
 * picker: the run contract can only express "pin this machine"
 * (`requestedDeviceId` forces device routing), and has no way to force the
 * cloud sandbox over an agent's stored target. So the agent's own target is
 * offered only when it is not one of the listed machines, as the row that
 * removes the pin — never as a "Cloud Sandbox" row that would silently do
 * nothing whenever the agent's own target is a device.
 *
 * The machines are listed flat. There are at most a handful, they are all the
 * same kind of thing, and the grouping our chat picker needs (personal vs the
 * workspace pool, where a workspace agent's list is *filtered* by group) has no
 * counterpart here — a task pins a specific machine the user can see.
 */
const TaskDeviceChip = memo<TaskDeviceChipProps>(
  ({
    agentId,
    className,
    disabled,
    followDirectory,
    following,
    onChange,
    onFollowChange,
    value,
  }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);

    const {
      canSelect,
      devices,
      devicesFailed,
      directoryKind,
      inheritedDeviceId,
      inheritedLabel,
      inheritedTarget,
      isPending,
      pinnedDeviceId,
      retryDevices,
    } = useTaskRunTarget(agentId, value);

    // An author-fixed target still leaves the directory choosable, so the switch
    // only locks when neither axis is. A task already off the agent keeps the
    // switch, so it can always return to following.
    const canCustomize = canSelect || directoryKind !== 'none';
    const lockReason = getTaskDeviceLockReason({
      canSelect: canCustomize || !following,
      disabled,
      isPending,
    });
    const isLocked = !!lockReason;

    // Read the EFFECTIVE pin, never the raw prop: an author-fixed policy makes
    // the run side drop a requested device, and showing the stored one would
    // name a machine this task's runs never reach.
    const pinned = pinnedDeviceId
      ? devices?.find((device) => device.deviceId === pinnedDeviceId)
      : undefined;
    const unknownLabel = t('heteroAgent.executionTarget.unknownDevice');
    // A pin whose device is not in the pool at all — unshared, deleted, or
    // enrolled under another identity — must still read as a PINNED run:
    // falling back to the inherited label would describe a target the run does
    // not use, and would hide the one control that can clear it. While the list
    // is still loading that is indistinguishable from "not here yet", so the
    // inherited label stays until it settles.
    const pinnedLabel = pinned
      ? deviceLabel(pinned, unknownLabel)
      : isPending
        ? inheritedLabel
        : unknownLabel;
    // The agent's own target needs a row of its own only when no listed machine
    // stands for it (the cloud sandbox, or a machine outside the task pool), or
    // when the policy fixes it and the list cannot be picked from at all.
    const isAgentTargetListed =
      !!inheritedDeviceId && !!devices?.some((device) => device.deviceId === inheritedDeviceId);
    const showAgentTargetRow = !canSelect || !isAgentTargetListed;

    const handleSelect = useCallback(
      (deviceId: string | undefined) => {
        if (isLocked || !canSelect) return;
        onChange(deviceId);
        setOpen(false);
      },
      [canSelect, isLocked, onChange],
    );

    const renderDeviceRow = (device: DeviceListItem) => {
      const isActive = device.deviceId === pinnedDeviceId;
      return (
        <TaskPickerOption
          checked={isActive}
          disabled={isLocked}
          key={device.deviceId}
          onSelect={() => handleSelect(device.deviceId)}
        >
          <ExecutionTargetIcon devicePlatform={device.platform} target={'device'} />
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <Flexbox horizontal align={'center'} gap={6}>
              <div className={styles.rowTitle}>{deviceLabel(device, unknownLabel)}</div>
              {device.deviceId === inheritedDeviceId && (
                <span className={styles.badge}>{t('taskExecution.agentDefault')}</span>
              )}
            </Flexbox>
            <div className={styles.rowDesc}>
              <ExecutionTargetDeviceStatus
                offlineLabel={t('heteroAgent.executionTarget.offline')}
                online={device.online}
                onlineLabel={t('heteroAgent.executionTarget.online')}
                unknown={device.onlineUnknown}
                unknownLabel={t('heteroAgent.executionTarget.presenceChecking')}
              />
            </div>
          </Flexbox>
          {isActive && <Icon className={styles.check} icon={CheckIcon} size={14} />}
        </TaskPickerOption>
      );
    };

    const followRow = (
      <Flexbox horizontal align={'center'} className={styles.switchRow} gap={12}>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <div className={styles.rowTitle}>{t('taskExecution.followAgent')}</div>
          <div className={styles.rowDesc}>{t('taskExecution.followAgentDesc')}</div>
          {following && (
            <Flexbox horizontal align={'center'} className={styles.followSummary} gap={4}>
              <ExecutionTargetIcon target={inheritedTarget} />
              <span className={styles.hintValue}>{inheritedLabel}</span>
              {followDirectory && (
                <>
                  <span>·</span>
                  <Icon icon={FolderIcon} size={12} />
                  <span className={styles.hintValue}>{followDirectory}</span>
                </>
              )}
            </Flexbox>
          )}
        </Flexbox>
        <Switch
          aria-label={t('taskExecution.followAgent')}
          checked={following}
          size={'small'}
          onChange={onFollowChange}
        />
      </Flexbox>
    );

    const deviceSection = (
      <>
        <div className={styles.sectionTitle}>{t('taskExecution.runLocation')}</div>
        {showAgentTargetRow && (
          <TaskPickerOption
            checked={!pinnedDeviceId}
            disabled={isLocked || !canSelect}
            onSelect={() => handleSelect(undefined)}
          >
            <ExecutionTargetIcon target={inheritedTarget} />
            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <div className={styles.rowTitle}>{inheritedLabel}</div>
              <div className={styles.rowDesc}>
                {canSelect ? t('taskExecution.agentDefault') : t('taskExecution.fixedTip')}
              </div>
            </Flexbox>
            {!pinnedDeviceId && <Icon className={styles.check} icon={CheckIcon} size={14} />}
          </TaskPickerOption>
        )}

        {canSelect && (
          <>
            {isPending && (
              <div className={styles.sectionTitle}>{t('heteroAgent.executionTarget.loading')}</div>
            )}
            {devicesFailed && (
              <div className={styles.emptyHint}>
                {t('heteroAgent.executionTarget.loadFailed')}{' '}
                <a role="button" onClick={retryDevices}>
                  {t('retry', { ns: 'common' })}
                </a>
              </div>
            )}
            {!isPending && !devicesFailed && devices && devices.length > 0 && (
              <div className={styles.scroll}>{devices.map(renderDeviceRow)}</div>
            )}
            {!isPending && !devicesFailed && devices?.length === 0 && (
              <div className={styles.emptyHint}>{t('heteroAgent.executionTarget.noDevices')}</div>
            )}
          </>
        )}
      </>
    );

    const content = (
      <Flexbox
        aria-label={t('taskExecution.environment')}
        gap={4}
        role={'group'}
        style={{ minWidth: 280 }}
      >
        <div className={styles.sectionTitle}>{t('taskExecution.environment')}</div>
        {followRow}
        {!following && deviceSection}
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
        {!following && pinnedDeviceId ? (
          <ExecutionTargetIcon devicePlatform={pinned?.platform} target={'device'} />
        ) : (
          <ExecutionTargetIcon target={inheritedTarget} />
        )}
        <Text ellipsis className={styles.chipLabel} fontSize={12}>
          {following
            ? t('taskExecution.followAgent')
            : pinnedDeviceId
              ? pinnedLabel
              : inheritedLabel}
        </Text>
        <Icon icon={ChevronDownIcon} size={12} />
      </Block>
    );

    if (isLocked) {
      return (
        <Tooltip
          title={formatLockedControlTooltip(
            t('taskExecution.environment'),
            lockReason === 'pending'
              ? t('heteroAgent.executionTarget.presenceChecking')
              : t('taskExecution.fixedTip'),
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
