'use client';

import { isDesktop } from '@lobechat/const';
import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget, DeviceListItem } from '@lobechat/types';
import type { SelectOption, SelectOptions } from '@lobehub/ui';
import { Select, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import {
  isCurrentMachineDevice,
  isDeviceOffline,
  splitPickerDevices,
  useCurrentMachine,
} from '@/features/DeviceManager/devicePicker';
import { OfflineDevicesToggle } from '@/features/DeviceManager/OfflineDevicesToggle';
import {
  devicePoolForAgent,
  ExecutionTargetLabel,
  executionTargetSelectClassNames,
  executionTargetValue,
  groupExecutionTargetDevices,
  parseExecutionTargetValue,
} from '@/features/ExecutionTargetPicker';
import { useAgentManagementAccess } from '@/features/ResourcePermission/useAgentManagementAccess';
import { isHeterogeneousSandboxExecutionAvailable } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';
import { useDeviceList } from '@/store/device';

import {
  getPrivateDeviceBlock,
  getTargetHint,
  getTargetSelectValue,
} from './heteroTargetSelection';

const styles = stylex.create({
  select: {
    maxWidth: 480,
    width: '100%',
  },
});

type FixedTarget = Extract<DeviceExecutionTarget, 'auto' | 'local' | 'none' | 'sandbox'>;

interface HeteroExecutionTargetSelectProps {
  agentId: string;
  deviceId?: string;
  isOverridden: boolean;
  isPending: boolean;
  isSelectable: boolean;
  /** The heterogeneous runtime; absent for a LobeHub agent. */
  providerType?: string;
  target: DeviceExecutionTarget;
}

/**
 * Where an agent's new topics run, as the current caller will
 * actually run them: the picker, the line saying whose pick applies, and the
 * device-list error. The host supplies the surrounding card.
 *
 * A LobeHub agent (no `providerType`) also lists "No device" and "Auto", as the
 * chat-input switcher does; a heterogeneous agent must run somewhere, so it
 * does not.
 *
 * Picks go through the same writer as the chat-input switcher, so a member
 * changes only their own environment and a manager's pick replaces the shared
 * default.
 */
export const HeteroExecutionTargetSelect = memo<HeteroExecutionTargetSelectProps>(
  ({ agentId, deviceId, isOverridden, isPending, isSelectable, providerType, target }) => {
    const { t } = useTranslation(['setting', 'chat', 'device']);
    const currentMachine = useCurrentMachine();
    const [showOffline, setShowOffline] = useState(false);
    const agent = useAgentStore((s) => s.agentMap[agentId]);
    const isWorkspaceAgent = !!agent?.workspaceId;
    const { canManageAgent } = useAgentManagementAccess(agentId);
    const selectExecutionTarget = useSelectExecutionTarget(agentId);
    const supportsSandbox = isHeterogeneousSandboxExecutionAvailable(providerType);
    const builtin = !providerType;

    const { data: devices, error, isConfirmed, isLoading, mutate } = useDeviceList();
    const { personal, privateWorkspace, workspace } = groupExecutionTargetDevices(devices);
    const privateDeviceBlock = getPrivateDeviceBlock({
      canManageAgent,
      isWorkspaceAgent,
      selectionPolicy: agent?.agencyConfig?.executionTargetSelectionPolicy,
      visibility: agent?.visibility,
    });
    const privateDeviceBlockedReason = privateDeviceBlock
      ? t(
          privateDeviceBlock === 'fixed'
            ? 'settingAgent.devicePolicy.privateDeviceFixed'
            : 'settingAgent.devicePolicy.privateDevicePublicAgent',
        )
      : undefined;

    const fixedTargetLabels: Record<FixedTarget, { description: string; label: string }> = {
      auto: {
        description: t('chat:heteroAgent.executionTarget.autoDesc'),
        label: t('chat:heteroAgent.executionTarget.auto'),
      },
      local: {
        description: t('chat:heteroAgent.executionTarget.localDesc'),
        label: t('chat:heteroAgent.executionTarget.local'),
      },
      none: {
        description: t('chat:heteroAgent.executionTarget.noneDesc'),
        label: t('chat:heteroAgent.executionTarget.none'),
      },
      sandbox: {
        description: t(
          supportsSandbox
            ? 'chat:heteroAgent.executionTarget.sandboxDesc'
            : 'chat:heteroAgent.executionTarget.sandboxUnsupported',
          {
            name: providerType
              ? HETEROGENEOUS_TYPE_LABELS[providerType as keyof typeof HETEROGENEOUS_TYPE_LABELS]
              : undefined,
          },
        ),
        label: t('chat:heteroAgent.executionTarget.sandbox'),
      },
    };
    const statusLabels = {
      offlineLabel: t('chat:heteroAgent.executionTarget.offline'),
      onlineLabel: t('chat:heteroAgent.executionTarget.online'),
      unknownLabel: t('chat:heteroAgent.executionTarget.presenceChecking'),
    };

    const renderFixedTargetLabel = (fixedTarget: FixedTarget, compact = false) => (
      <ExecutionTargetLabel
        {...statusLabels}
        compact={compact}
        description={fixedTargetLabels[fixedTarget].description}
        label={fixedTargetLabels[fixedTarget].label}
        target={fixedTarget}
      />
    );
    const renderDeviceLabel = (device: DeviceListItem, compact = false) => (
      <ExecutionTargetLabel
        {...statusLabels}
        compact={compact}
        description=""
        device={device}
        target={'device'}
        label={
          isCurrentMachineDevice(device, currentMachine)
            ? `${device.friendlyName || device.hostname || device.deviceId} · ${t('device:picker.thisDevice')}`
            : device.friendlyName || device.hostname || device.deviceId
        }
      />
    );

    // Until the server confirms the list, the stored copy may hold devices that
    // were since removed (binding one points the agent at a machine it cannot
    // reach): show its rows, but only a confirmed row can be picked.
    const toDeviceOption = (device: DeviceListItem, blocked = false): SelectOption<string> => ({
      disabled: !isConfirmed || blocked,
      label: renderDeviceLabel(device),
      title: device.friendlyName || device.hostname || device.deviceId,
      value: executionTargetValue('device', device.deviceId),
    });
    const poolStatusOptions = (rows: DeviceListItem[], emptyLabel: string) =>
      isLoading || (!isConfirmed && rows.length === 0)
        ? [
            {
              disabled: true,
              label: t('chat:heteroAgent.executionTarget.loading'),
              value: 'status:loading',
            },
          ]
        : rows.length === 0
          ? [{ disabled: true, label: emptyLabel, value: 'status:empty' }]
          : [];

    // This machine first, then reachable devices; offline ones fold into one
    // group at the end unless one of them is the pick.
    const pickedDeviceId = target === 'device' ? deviceId : undefined;
    const folds = (device: DeviceListItem) =>
      isConfirmed && isDeviceOffline(device) && device.deviceId !== pickedDeviceId;
    const ordered = (rows: DeviceListItem[]) => {
      const { available, offline } = splitPickerDevices(rows, currentMachine);
      return [...available, ...offline].filter((device) => !folds(device));
    };
    const foldedDevices = (
      isWorkspaceAgent ? [...privateWorkspace, ...workspace] : personal
    ).filter(folds);
    const offlineGroup: SelectOptions<string> =
      !error && foldedDevices.length > 0
        ? [
            {
              label: (
                <OfflineDevicesToggle
                  count={foldedDevices.length}
                  expanded={showOffline}
                  onToggle={() => setShowOffline((v) => !v)}
                />
              ),
              options: showOffline
                ? foldedDevices.map((device) =>
                    toDeviceOption(
                      device,
                      device.scope === 'workspace' &&
                        device.visibility === 'private' &&
                        !!privateDeviceBlockedReason,
                    ),
                  )
                : [],
            },
          ]
        : [];

    const fixedTargetOption = (fixedTarget: FixedTarget): SelectOption<string> => ({
      label: renderFixedTargetLabel(fixedTarget),
      title: fixedTargetLabels[fixedTarget].label,
      value: executionTargetValue(fixedTarget),
    });
    const fixedTargetOptions: SelectOption<string>[] = [
      ...(builtin ? [fixedTargetOption('none'), fixedTargetOption('auto')] : []),
      ...(isDesktop
        ? [
            {
              label: renderFixedTargetLabel('local'),
              title: fixedTargetLabels.local.label,
              value: executionTargetValue('local'),
            },
          ]
        : []),
      {
        disabled: !supportsSandbox,
        label: renderFixedTargetLabel('sandbox'),
        title: fixedTargetLabels.sandbox.label,
        value: executionTargetValue('sandbox'),
      },
    ];

    // A personal agent lists the account's own devices flat, as the chat
    // switcher does: Private / Workspace name workspace pools only.
    const deviceOptions: SelectOptions<string> = error
      ? []
      : !isWorkspaceAgent
        ? [
            ...ordered(personal).map((device) => toDeviceOption(device)),
            ...poolStatusOptions(personal, t('chat:heteroAgent.executionTarget.noDevices')),
          ]
        : [
            // Only the caller's own private devices reach this list, so the
            // group is simply absent for anyone without one.
            ...(!isLoading && privateWorkspace.length > 0
              ? [
                  {
                    label: t('chat:heteroAgent.executionTarget.personalGroup'),
                    options: [
                      ...ordered(privateWorkspace).map((device) =>
                        toDeviceOption(device, !!privateDeviceBlockedReason),
                      ),
                      ...(privateDeviceBlockedReason
                        ? [
                            {
                              disabled: true,
                              label: privateDeviceBlockedReason,
                              value: 'status:privateUnavailable',
                            },
                          ]
                        : []),
                    ],
                  },
                ]
              : []),
            {
              label: t('chat:heteroAgent.executionTarget.workspaceGroup'),
              options: [
                ...ordered(workspace).map((device) => toDeviceOption(device)),
                ...poolStatusOptions(workspace, t('settingAgent.devicePolicy.noPublicDevice')),
              ],
            },
          ];

    const hint = getTargetHint({ isOverridden, isSelectable });

    return (
      <>
        <Select
          {...stylex.props(styles.select)}
          classNames={executionTargetSelectClassNames}
          disabled={isPending || !isSelectable}
          optionRender={(option) => option.label}
          options={[...fixedTargetOptions, ...deviceOptions, ...offlineGroup]}
          placeholder={t('settingAgent.devicePolicy.selectTarget')}
          popupMatchSelectWidth={true}
          value={getTargetSelectValue(target, deviceId, { builtin })}
          labelRender={(option) => {
            if (typeof option.value !== 'string') return option.label;
            const selection = parseExecutionTargetValue(option.value);
            if (!selection) return option.label;
            if (selection.target !== 'device')
              return renderFixedTargetLabel(selection.target, true);
            const device = devicePoolForAgent(devices, isWorkspaceAgent).find(
              (item) => item.deviceId === selection.deviceId,
            );
            if (device) return renderDeviceLabel(device, true);

            // The bound device is not in this caller's pool (removed, unshared,
            // or the list is still loading): name that instead of a raw id.
            return t(
              isConfirmed
                ? 'chat:heteroAgent.executionTarget.unknownDevice'
                : 'chat:heteroAgent.executionTarget.loading',
            );
          }}
          onChange={(next) => {
            if (typeof next !== 'string') return;
            const selection = parseExecutionTargetValue(next);
            if (!selection) return;
            void selectExecutionTarget(selection.target, selection.deviceId);
          }}
        />
        <Text fontSize={12} type={'secondary'}>
          {t(
            hint === 'fixed'
              ? 'heterogeneousStatus.target.fixed'
              : hint === 'overridden'
                ? 'heterogeneousStatus.target.overridden'
                : 'heterogeneousStatus.target.desc',
          )}
        </Text>
        {error ? (
          <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
        ) : null}
      </>
    );
  },
);

HeteroExecutionTargetSelect.displayName = 'HeteroExecutionTargetSelect';
