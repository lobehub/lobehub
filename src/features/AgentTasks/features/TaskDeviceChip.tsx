'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import { Block, Flexbox, Icon, Popover, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatLockedControlTooltip } from '@/features/ChatInput/utils/lockedControlTooltip';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import {
  ExecutionTargetDeviceStatus,
  ExecutionTargetIcon,
  groupExecutionTargetDevices,
} from '@/features/ExecutionTargetPicker';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { taskExecutionStyles as styles } from './taskExecutionStyles';

interface TaskDeviceChipProps {
  /** The assignee whose execution environment is inherited when nothing is pinned. */
  agentId: string;
  /**
   * Row class for the trigger. Omitted → the composer's compact chip; the task
   * detail's properties rail passes its own full-width row class instead.
   */
  className?: string;
  disabled?: boolean;
  /** Pinned device, or `undefined` to inherit the assignee agent's target. */
  onChange: (deviceId: string | undefined) => void;
  value?: string;
}

const deviceLabel = (
  device: Pick<DeviceListItem, 'deviceId' | 'friendlyName' | 'hostname'>,
  unknownLabel: string,
) => device.friendlyName || device.hostname || unknownLabel;

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
 */
const TaskDeviceChip = memo<TaskDeviceChipProps>(
  ({ agentId, className, disabled, onChange, value }) => {
    const { t } = useTranslation('chat');
    const [open, setOpen] = useState(false);
    const { data: devices, isLoading } = useDeviceList();

    const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
    const { agencyConfig, canSelectExecutionTarget, isPreferenceLoading, workspaceScoped } =
      useEffectiveAgencyConfig(agentId);
    const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);

    // The agent's policy is author-controlled: the server's resolver would drop
    // this pin, so the control must not pretend it can set one.
    const isLocked = disabled || isPreferenceLoading || !canSelectExecutionTarget;

    const pinned = value ? devices?.find((device) => device.deviceId === value) : undefined;
    const unknownLabel = t('heteroAgent.executionTarget.unknownDevice');

    // What the run will do when the task pins nothing — shown as the summary
    // and as the "Follow the agent" row's description, so inheritance is
    // legible instead of a black box.
    const inheritedTarget = resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: isDesktop,
      deviceRoutingAvailable,
      isHetero,
      workspaceScoped,
    });
    const inheritedLabel = (() => {
      if (inheritedTarget === 'device') {
        const bound = devices?.find((device) => device.deviceId === agencyConfig?.boundDeviceId);
        return bound ? deviceLabel(bound, unknownLabel) : unknownLabel;
      }
      return t(`heteroAgent.executionTarget.${inheritedTarget}`);
    })();

    const handleSelect = useCallback(
      (deviceId: string | undefined) => {
        if (isLocked) return;
        onChange(deviceId);
        setOpen(false);
      },
      [isLocked, onChange],
    );

    const groups = groupExecutionTargetDevices(devices ?? []);
    const isInheriting = !value;

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

        {isLoading && (
          <div className={styles.sectionTitle}>{t('heteroAgent.executionTarget.loading')}</div>
        )}
        {!isLoading && groups.personal.length > 0 && (
          <>
            <div className={styles.sectionTitle}>
              {t('heteroAgent.executionTarget.personalGroup')}
            </div>
            <div className={styles.scroll}>{groups.personal.map(renderDeviceRow)}</div>
          </>
        )}
        {!isLoading && groups.workspace.length > 0 && (
          <>
            <div className={styles.sectionTitle}>
              {t('heteroAgent.executionTarget.workspaceGroup')}
            </div>
            <div className={styles.scroll}>{groups.workspace.map(renderDeviceRow)}</div>
          </>
        )}
        {!isLoading && groups.personal.length === 0 && groups.workspace.length === 0 && (
          <div className={styles.rowDesc} style={{ paddingBlock: 6, paddingInline: 8 }}>
            {t('heteroAgent.executionTarget.noDevices')}
          </div>
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
