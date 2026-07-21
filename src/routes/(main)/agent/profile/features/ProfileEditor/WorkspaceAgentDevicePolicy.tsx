'use client';

import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { DeviceExecutionTarget, DeviceListItem, LobeAgentAgencyConfig } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import type { SelectOptions } from '@lobehub/ui/base-ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MonitorSmartphone } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useDeviceList } from '@/features/DeviceManager/useDeviceList';
import {
  ExecutionTargetDeviceStatus,
  ExecutionTargetIcon,
  executionTargetValue,
  groupExecutionTargetDevices,
  isSharedExecutionTarget,
  parseExecutionTargetValue,
} from '@/features/ExecutionTargetPicker';
import { isHeterogeneousSandboxExecutionAvailable } from '@/helpers/executionTarget';
import { useAgentStore } from '@/store/agent';

import {
  WorkspaceAgentPolicyCard,
  WorkspaceAgentSelectionPolicyMenu,
} from './WorkspaceAgentPolicyCard';

const styles = createStaticStyles(({ css }) => ({
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

interface ExecutionTargetLabelProps {
  compact?: boolean;
  description: string;
  device?: DeviceListItem;
  label: string;
  offlineLabel: string;
  onlineLabel: string;
  target: DeviceExecutionTarget;
}

const ExecutionTargetLabel = memo<ExecutionTargetLabelProps>(
  ({ compact, description, device, label, offlineLabel, onlineLabel, target }) => {
    const icon = <ExecutionTargetIcon devicePlatform={device?.platform} target={target} />;
    const secondary = device ? (
      <ExecutionTargetDeviceStatus
        offlineLabel={offlineLabel}
        online={device.online}
        onlineLabel={onlineLabel}
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

ExecutionTargetLabel.displayName = 'WorkspaceAgentDevicePolicy.ExecutionTargetLabel';

interface WorkspaceAgentDevicePolicyProps {
  agentId: string;
  showDevicePicker?: boolean;
}

const WorkspaceAgentDevicePolicy = memo<WorkspaceAgentDevicePolicyProps>(
  ({ agentId, showDevicePicker = true }) => {
    const { t } = useTranslation(['setting', 'chat']);
    const config = useAgentStore((s) => s.agentMap[agentId]);
    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

    const { data: devices, error, isLoading, mutate } = useDeviceList();
    const { publicWorkspace: publicWorkspaceDevices } = useMemo(
      () => groupExecutionTargetDevices(devices),
      [devices],
    );
    const agencyConfig = config?.agencyConfig;
    const heterogeneousType = agencyConfig?.heterogeneousProvider?.type;
    const isHeterogeneous = !!heterogeneousType;
    const supportsSandbox = isHeterogeneousSandboxExecutionAvailable(heterogeneousType);
    const boundDevice = publicWorkspaceDevices.find(
      (device) => device.deviceId === agencyConfig?.boundDeviceId,
    );
    const isFixed = agencyConfig?.executionTargetSelectionPolicy === 'fixed';

    const targetLabels = useMemo(
      () => ({
        auto: {
          description: t('chat:heteroAgent.executionTarget.autoDesc'),
          label: t('chat:heteroAgent.executionTarget.auto'),
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
              name: heterogeneousType ? HETEROGENEOUS_TYPE_LABELS[heterogeneousType] : undefined,
            },
          ),
          label: t('chat:heteroAgent.executionTarget.sandbox'),
        },
      }),
      [heterogeneousType, supportsSandbox, t],
    );

    const renderTargetLabel = useCallback(
      (target: 'auto' | 'none' | 'sandbox', compact = false) => (
        <ExecutionTargetLabel
          compact={compact}
          description={targetLabels[target].description}
          label={targetLabels[target].label}
          offlineLabel={t('chat:heteroAgent.executionTarget.offline')}
          onlineLabel={t('chat:heteroAgent.executionTarget.online')}
          target={target}
        />
      ),
      [t, targetLabels],
    );

    const renderDeviceLabel = useCallback(
      (device: DeviceListItem, compact = false) => (
        <ExecutionTargetLabel
          compact={compact}
          description=""
          device={device}
          label={device.friendlyName || device.hostname || device.deviceId}
          offlineLabel={t('chat:heteroAgent.executionTarget.offline')}
          onlineLabel={t('chat:heteroAgent.executionTarget.online')}
          target={'device'}
        />
      ),
      [t],
    );

    const targetOptions = useMemo<SelectOptions<string>>(() => {
      const sharedTargets: SelectOptions<string> = [
        ...(!isHeterogeneous
          ? [
              {
                label: renderTargetLabel('none'),
                title: targetLabels.none.label,
                value: executionTargetValue('none'),
              },
              {
                label: renderTargetLabel('auto'),
                title: targetLabels.auto.label,
                value: executionTargetValue('auto'),
              },
            ]
          : []),
        {
          disabled: !supportsSandbox,
          label: renderTargetLabel('sandbox'),
          title: targetLabels.sandbox.label,
          value: executionTargetValue('sandbox'),
        },
      ];

      const workspaceOptions = isLoading
        ? [
            {
              disabled: true,
              label: t('chat:heteroAgent.executionTarget.loading'),
              value: 'status:loading',
            },
          ]
        : publicWorkspaceDevices.length > 0
          ? publicWorkspaceDevices.map((device) => ({
              label: renderDeviceLabel(device),
              title: device.friendlyName || device.hostname || device.deviceId,
              value: executionTargetValue('device', device.deviceId),
            }))
          : [
              {
                disabled: true,
                label: t('settingAgent.devicePolicy.noPublicDevice'),
                value: 'status:empty',
              },
            ];

      return [
        ...sharedTargets,
        ...(!error
          ? [
              {
                label: t('chat:heteroAgent.executionTarget.workspaceGroup'),
                options: workspaceOptions,
              },
            ]
          : []),
      ];
    }, [
      error,
      isLoading,
      isHeterogeneous,
      publicWorkspaceDevices,
      renderDeviceLabel,
      renderTargetLabel,
      supportsSandbox,
      t,
      targetLabels,
    ]);

    const configuredTarget = agencyConfig?.executionTarget;
    const selectedTarget =
      configuredTarget === 'device' && boundDevice
        ? { deviceId: boundDevice.deviceId, target: 'device' as const }
        : isSharedExecutionTarget(configuredTarget) && configuredTarget !== 'device'
          ? { target: configuredTarget }
          : configuredTarget === undefined && !isHeterogeneous
            ? { target: 'none' as const }
            : undefined;
    const selectedValue = selectedTarget
      ? executionTargetValue(selectedTarget.target, selectedTarget.deviceId)
      : undefined;
    const canLockCurrentTarget =
      !!selectedTarget && (selectedTarget.target !== 'sandbox' || supportsSandbox);

    const saveAgencyConfig = useCallback(
      (patch: Partial<LobeAgentAgencyConfig>) =>
        updateAgentConfigById(agentId, { agencyConfig: patch }),
      [agentId, updateAgentConfigById],
    );

    if (!config?.workspaceId) return null;

    return (
      <WorkspaceAgentPolicyCard
        icon={MonitorSmartphone}
        title={t('settingAgent.devicePolicy.title')}
        action={
          <WorkspaceAgentSelectionPolicyMenu
            locked={isFixed}
            lockedDisabled={!isFixed && !canLockCurrentTarget}
            lockedLabel={t('settingAgent.selectionPolicy.membersCannotSwitch')}
            unlockedLabel={t('settingAgent.selectionPolicy.membersCanSwitch')}
            onChange={(locked) => {
              if (!locked) {
                void saveAgencyConfig({ executionTargetSelectionPolicy: 'member' });
                return;
              }
              if (!selectedTarget) return;

              void saveAgencyConfig({
                ...(selectedTarget.deviceId ? { boundDeviceId: selectedTarget.deviceId } : {}),
                executionTarget: selectedTarget.target,
                executionTargetSelectionPolicy: 'fixed',
              });
            }}
          />
        }
      >
        {showDevicePicker ? (
          <Select
            optionRender={(option) => option.label}
            options={targetOptions}
            placeholder={t('settingAgent.devicePolicy.selectTarget')}
            popupMatchSelectWidth={true}
            value={selectedValue}
            classNames={{
              item: styles.selectItem,
              popup: styles.selectPopup,
              value: styles.selectValue,
            }}
            labelRender={(option) => {
              if (typeof option.value !== 'string') return option.label;
              const selection = parseExecutionTargetValue(option.value);
              if (!selection) return option.label;
              if (selection.target === 'device') {
                const device = publicWorkspaceDevices.find(
                  (item) => item.deviceId === selection.deviceId,
                );
                return device ? renderDeviceLabel(device, true) : option.label;
              }
              if (selection.target === 'local') return option.label;
              return renderTargetLabel(selection.target, true);
            }}
            onChange={(value) => {
              if (typeof value !== 'string') return;
              const selection = parseExecutionTargetValue(value);
              if (!selection) return;

              void saveAgencyConfig({
                ...(selection.deviceId ? { boundDeviceId: selection.deviceId } : {}),
                executionTarget: selection.target,
              });
            }}
          />
        ) : null}

        {error ? (
          <AsyncError error={error} variant={'inline'} onRetry={() => void mutate()} />
        ) : null}
      </WorkspaceAgentPolicyCard>
    );
  },
);

WorkspaceAgentDevicePolicy.displayName = 'WorkspaceAgentDevicePolicy';

export default WorkspaceAgentDevicePolicy;
