'use client';

import { isDesktop } from '@lobechat/const';
import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget, DeviceListItem } from '@lobechat/types';
import type { SelectOption, SelectOptions } from '@lobehub/ui';
import { Select, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MonitorSmartphone } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import {
  devicePoolForAgent,
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
import {
  ExecutionTargetLabel,
  executionTargetSelectClassNames,
} from './WorkspaceAgentDevicePolicy';
import { WorkspaceAgentPolicyCard } from './WorkspaceAgentPolicyCard';

const styles = stylex.create({
  select: {
    maxWidth: 480,
    width: '100%',
  },
});

type FixedTarget = Extract<DeviceExecutionTarget, 'local' | 'sandbox'>;

interface HeteroExecutionTargetSelectProps {
  agentId: string;
  deviceId?: string;
  isOverridden: boolean;
  isPending: boolean;
  isSelectable: boolean;
  providerType: string;
  target: DeviceExecutionTarget;
}

/**
 * Where a heterogeneous agent's new topics run, as the current caller will
 * actually run them. Picks go through the same writer as the chat-input
 * switcher, so a member changes only their own environment and a manager's
 * pick replaces the shared default.
 */
const HeteroExecutionTargetSelect = memo<HeteroExecutionTargetSelectProps>(
  ({ agentId, deviceId, isOverridden, isPending, isSelectable, providerType, target }) => {
    const { t } = useTranslation(['setting', 'chat']);
    const agent = useAgentStore((s) => s.agentMap[agentId]);
    const isWorkspaceAgent = !!agent?.workspaceId;
    const { canManageAgent } = useAgentManagementAccess(agentId);
    const selectExecutionTarget = useSelectExecutionTarget(agentId);
    const supportsSandbox = isHeterogeneousSandboxExecutionAvailable(providerType);

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
      local: {
        description: t('chat:heteroAgent.executionTarget.localDesc'),
        label: t('chat:heteroAgent.executionTarget.local'),
      },
      sandbox: {
        description: t(
          supportsSandbox
            ? 'chat:heteroAgent.executionTarget.sandboxDesc'
            : 'chat:heteroAgent.executionTarget.sandboxUnsupported',
          {
            name: HETEROGENEOUS_TYPE_LABELS[providerType as keyof typeof HETEROGENEOUS_TYPE_LABELS],
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
        label={device.friendlyName || device.hostname || device.deviceId}
        target={'device'}
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

    const fixedTargetOptions: SelectOption<string>[] = [
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
            ...personal.map((device) => toDeviceOption(device)),
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
                      ...privateWorkspace.map((device) =>
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
                ...workspace.map((device) => toDeviceOption(device)),
                ...poolStatusOptions(workspace, t('settingAgent.devicePolicy.noPublicDevice')),
              ],
            },
          ];

    const hint = getTargetHint({ isOverridden, isSelectable });

    return (
      <WorkspaceAgentPolicyCard
        fullWidth
        icon={MonitorSmartphone}
        title={t('settingAgent.devicePolicy.title')}
      >
        <Select
          {...stylex.props(styles.select)}
          classNames={executionTargetSelectClassNames}
          disabled={isPending || !isSelectable}
          optionRender={(option) => option.label}
          options={[...fixedTargetOptions, ...deviceOptions]}
          placeholder={t('settingAgent.devicePolicy.selectTarget')}
          popupMatchSelectWidth={true}
          value={getTargetSelectValue(target, deviceId)}
          labelRender={(option) => {
            if (typeof option.value !== 'string') return option.label;
            const selection = parseExecutionTargetValue(option.value);
            if (!selection) return option.label;
            if (selection.target === 'local' || selection.target === 'sandbox')
              return renderFixedTargetLabel(selection.target, true);
            if (selection.target !== 'device') return option.label;

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
      </WorkspaceAgentPolicyCard>
    );
  },
);

HeteroExecutionTargetSelect.displayName = 'HeteroExecutionTargetSelect';

export default HeteroExecutionTargetSelect;
