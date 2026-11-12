'use client';

import { isDesktop } from '@lobechat/const';
import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';
import type { DeviceListItem, LobeAgentAgencyConfig } from '@lobechat/types';
import type { SelectOption, SelectOptions } from '@lobehub/ui';
import { Select } from '@lobehub/ui';
import { MonitorSmartphone } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import {
  ExecutionTargetLabel,
  executionTargetSelectClassNames,
  executionTargetValue,
  groupExecutionTargetDevices,
  parseExecutionTargetValue,
  resolveExecutionTargetSelection,
} from '@/features/ExecutionTargetPicker';
import {
  isHeterogeneousSandboxExecutionAvailable,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useDeviceList } from '@/store/device';

import { AgentConfigCard } from './AgentConfigCard';

type TargetWithoutDevice = 'auto' | 'local' | 'none' | 'sandbox';

interface AgentExecutionEnvironmentProps {
  agentId: string;
  showDevicePicker?: boolean;
}

/**
 * Where the agent runs — the same card for personal and workspace agents.
 *
 * - **Workspace agent**: picks the shared default every member falls back to,
 *   from the workspace device pools. Whether members may switch it is
 *   configured on the Agent's Permission page.
 * - **Personal agent**: picks the agent's own target, through the same writer
 *   as the chat-input switcher, from this machine and the account's own
 *   devices.
 */
const AgentExecutionEnvironment = memo<AgentExecutionEnvironmentProps>(
  ({ agentId, showDevicePicker = true }) => {
    const { t } = useTranslation(['setting', 'chat']);
    const config = useAgentStore((s) => s.agentMap[agentId]);
    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
    const selectExecutionTarget = useSelectExecutionTarget(agentId);
    const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
    const isWorkspaceAgent = !!config?.workspaceId;

    const { data: devices, error, isConfirmed, isLoading, mutate } = useDeviceList();
    const {
      personal: personalDevices,
      privateWorkspace: privateWorkspaceDevices,
      publicWorkspace: publicWorkspaceDevices,
    } = useMemo(() => groupExecutionTargetDevices(devices), [devices]);
    const selectableDevices = useMemo(
      () =>
        isWorkspaceAgent
          ? [...privateWorkspaceDevices, ...publicWorkspaceDevices]
          : personalDevices,
      [isWorkspaceAgent, personalDevices, privateWorkspaceDevices, publicWorkspaceDevices],
    );
    const agencyConfig = useAgentStore(agentByIdSelectors.getAgencyConfigById(agentId));
    // This card writes the shared config, so a private device (resolvable only
    // by the member who enrolled it) may be bound only when that member is the
    // sole runner: a private Agent. A fixed target must stay public — the
    // server rejects anything else (`assertFixedExecutionTarget`).
    const privateDeviceBlockedReason =
      config?.visibility !== 'private'
        ? t('settingAgent.devicePolicy.privateDevicePublicAgent')
        : agencyConfig?.executionTargetSelectionPolicy === 'fixed'
          ? t('settingAgent.devicePolicy.privateDeviceFixed')
          : undefined;
    const heterogeneousType = agencyConfig?.heterogeneousProvider?.type;
    const isHeterogeneous = !!heterogeneousType;
    const supportsSandbox = isHeterogeneousSandboxExecutionAvailable(heterogeneousType);

    const targetLabels = useMemo(
      () => ({
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
              name: heterogeneousType ? HETEROGENEOUS_TYPE_LABELS[heterogeneousType] : undefined,
            },
          ),
          label: t('chat:heteroAgent.executionTarget.sandbox'),
        },
      }),
      [heterogeneousType, supportsSandbox, t],
    );

    const renderTargetLabel = useCallback(
      (target: TargetWithoutDevice, compact = false) => (
        <ExecutionTargetLabel
          compact={compact}
          description={targetLabels[target].description}
          label={targetLabels[target].label}
          offlineLabel={t('chat:heteroAgent.executionTarget.offline')}
          onlineLabel={t('chat:heteroAgent.executionTarget.online')}
          target={target}
          unknownLabel={t('chat:heteroAgent.executionTarget.presenceChecking')}
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
          unknownLabel={t('chat:heteroAgent.executionTarget.presenceChecking')}
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
        // A workspace-shared default must never point at one member's machine.
        ...(!isWorkspaceAgent && isDesktop
          ? [
              {
                label: renderTargetLabel('local'),
                title: targetLabels.local.label,
                value: executionTargetValue('local'),
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

      // Until the server confirms the list, the stored copy may hold devices that
      // were since deleted or unshared (binding one would point the agent at an
      // unresolvable machine) or lack ones that exist: show its rows, but only
      // the confirmed list can be picked from or reported empty.
      const isPoolLoading = (rows: DeviceListItem[]) =>
        isLoading || (!isConfirmed && rows.length === 0);
      const loadingOption = {
        disabled: true,
        label: t('chat:heteroAgent.executionTarget.loading'),
        value: 'status:loading',
      };

      // A personal agent lists the account's own devices flat, as the chat
      // switcher does: Private / Workspace name workspace pools only.
      if (!isWorkspaceAgent) {
        if (error) return sharedTargets;

        return [
          ...sharedTargets,
          ...(isPoolLoading(personalDevices)
            ? [loadingOption]
            : personalDevices.length > 0
              ? personalDevices.map((device) => ({
                  disabled: !isConfirmed,
                  label: renderDeviceLabel(device),
                  title: device.friendlyName || device.hostname || device.deviceId,
                  value: executionTargetValue('device', device.deviceId),
                }))
              : [
                  {
                    disabled: true,
                    label: t('chat:heteroAgent.executionTarget.noDevices'),
                    value: 'status:empty',
                  },
                ]),
        ];
      }

      const workspaceOptions = isPoolLoading(publicWorkspaceDevices)
        ? [loadingOption]
        : publicWorkspaceDevices.length > 0
          ? publicWorkspaceDevices.map((device) => ({
              disabled: !isConfirmed,
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

      // Only the caller's own private devices reach this list, so the group is
      // simply absent for anyone without one.
      const privateOptions: SelectOption<string>[] = [
        ...privateWorkspaceDevices.map((device) => ({
          disabled: !isConfirmed || !!privateDeviceBlockedReason,
          label: renderDeviceLabel(device),
          title: device.friendlyName || device.hostname || device.deviceId,
          value: executionTargetValue('device', device.deviceId),
        })),
        ...(privateDeviceBlockedReason
          ? [
              {
                disabled: true,
                label: privateDeviceBlockedReason,
                value: 'status:privateUnavailable',
              },
            ]
          : []),
      ];

      return [
        ...sharedTargets,
        ...(!error && !isLoading && privateWorkspaceDevices.length > 0
          ? [
              {
                label: t('chat:heteroAgent.executionTarget.personalGroup'),
                options: privateOptions,
              },
            ]
          : []),
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
      isConfirmed,
      isLoading,
      isHeterogeneous,
      isWorkspaceAgent,
      personalDevices,
      privateDeviceBlockedReason,
      privateWorkspaceDevices,
      publicWorkspaceDevices,
      renderDeviceLabel,
      renderTargetLabel,
      supportsSandbox,
      t,
      targetLabels,
    ]);

    const workspaceSelection = isWorkspaceAgent
      ? resolveExecutionTargetSelection({
          boundDeviceId: agencyConfig?.boundDeviceId,
          configuredTarget: agencyConfig?.executionTarget,
          devices: selectableDevices,
          isHeterogeneous,
        })
      : undefined;
    // A personal agent shows what its next run will actually use here — the
    // chat-input switcher resolves it the same way, so the two never disagree
    // (desktop defaults to this machine; web shows a bound desktop as a device
    // when the gateway can reach it).
    const personalTarget = isWorkspaceAgent
      ? undefined
      : resolveExecutionTarget(agencyConfig, {
          clientExecutionAvailable: isDesktop,
          deviceRoutingAvailable,
          isHetero: isHeterogeneous,
        });
    const selectedValue = workspaceSelection
      ? executionTargetValue(workspaceSelection.target, workspaceSelection.deviceId)
      : personalTarget
        ? executionTargetValue(
            personalTarget,
            personalTarget === 'device' ? agencyConfig?.boundDeviceId : undefined,
          )
        : undefined;

    const saveAgencyConfig = useCallback(
      (patch: Partial<LobeAgentAgencyConfig>) =>
        updateAgentConfigById(agentId, { agencyConfig: patch }),
      [agentId, updateAgentConfigById],
    );

    if (!config) return null;

    return (
      <AgentConfigCard icon={MonitorSmartphone} title={t('settingAgent.devicePolicy.title')}>
        {showDevicePicker ? (
          <Select
            classNames={executionTargetSelectClassNames}
            optionRender={(option) => option.label}
            options={targetOptions}
            placeholder={t('settingAgent.devicePolicy.selectTarget')}
            popupMatchSelectWidth={true}
            value={selectedValue}
            labelRender={(option) => {
              if (typeof option.value !== 'string') return option.label;
              const selection = parseExecutionTargetValue(option.value);
              if (!selection) return option.label;
              if (selection.target === 'device') {
                const device = selectableDevices.find(
                  (item) => item.deviceId === selection.deviceId,
                );
                if (device) return renderDeviceLabel(device, true);
                if (isWorkspaceAgent) return option.label;

                // The bound device is not in this account's pool (removed, or the
                // list is still loading): name that instead of a raw id.
                return t(
                  isConfirmed
                    ? 'chat:heteroAgent.executionTarget.unknownDevice'
                    : 'chat:heteroAgent.executionTarget.loading',
                );
              }
              return renderTargetLabel(selection.target, true);
            }}
            onChange={(value) => {
              if (typeof value !== 'string') return;
              const selection = parseExecutionTargetValue(value);
              if (!selection) return;

              if (!isWorkspaceAgent) {
                void selectExecutionTarget(selection.target, selection.deviceId);
                return;
              }

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
      </AgentConfigCard>
    );
  },
);

AgentExecutionEnvironment.displayName = 'AgentExecutionEnvironment';

export default AgentExecutionEnvironment;
