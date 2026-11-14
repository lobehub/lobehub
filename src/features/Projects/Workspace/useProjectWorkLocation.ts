'use client';

import { isDesktop } from '@lobechat/const';
import type { DeviceExecutionTarget } from '@lobechat/types';

import { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { devicePoolForAgent } from '@/features/ExecutionTargetPicker';
import {
  isHeterogeneousSandboxExecutionAvailable,
  resolveExecutionTarget,
} from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { useDeviceList } from '@/store/device';
import { useElectronStore } from '@/store/electron';

/**
 * Where the picked agent's new conversation runs, resolved the way the run
 * resolves it, and the places it can be moved to: the cloud sandbox and the
 * devices the agent's runs can reach. Written the way the conversation's own
 * device picker writes it, so the two never disagree.
 */
export const useProjectWorkLocation = (agentId: string) => {
  const { agencyConfig, canDisplayExecutionTarget, canSelectExecutionTarget, workspaceScoped } =
    useEffectiveAgencyConfig(agentId, { topicId: null });
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const selectExecutionTarget = useSelectExecutionTarget(agentId);
  const isWorkspaceAgent = useAgentStore((s) => Boolean(s.agentMap[agentId]?.workspaceId));
  const { data: devices } = useDeviceList();

  const heteroType = agencyConfig?.heterogeneousProvider?.type;
  const target = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero: !!heteroType,
    workspaceScoped,
  });
  const boundDevice = devices?.find((device) => device.deviceId === agencyConfig?.boundDeviceId);
  // This desktop's own gateway id, which a `local` run works on.
  const currentDeviceId = useElectronStore((s) =>
    isDesktop ? s.gatewayDeviceInfo?.deviceId : undefined,
  );
  const switchable = canDisplayExecutionTarget && canSelectExecutionTarget;

  /** Resolves `false` when the move was refused or failed; picking the current place is a no-op. */
  const select = async (next: DeviceExecutionTarget, deviceId?: string) => {
    if (next === target && (next !== 'device' || deviceId === boundDevice?.deviceId)) return true;
    // The plain local row clears the local fence, as the conversation picker's does.
    const options = next === 'local' ? { localSandbox: false } : undefined;
    return selectExecutionTarget(next, deviceId, options);
  };

  return {
    boundDevice,
    /** This desktop's gateway id, on desktop only. */
    currentDeviceId,
    /** Whether the place is shown at all; a member without access sees nothing. */
    displayed: canDisplayExecutionTarget,
    /**
     * The machines offered. A fixed target still lists the machine the run is
     * on: its project folders stay a choice even though the machine is not.
     */
    deviceRows: switchable
      ? deviceRoutingAvailable
        ? devicePoolForAgent(devices, isWorkspaceAgent)
        : []
      : target === 'device' && boundDevice
        ? [boundDevice]
        : [],
    /** This desktop, as a place of its own — or as the fixed place the run already is. */
    localAvailable: (switchable && isDesktop) || target === 'local',
    /**
     * A device-only heterogeneous provider (Amp, Cursor, OpenCode, Pi, …) has
     * no sandbox toolchain: `resolveExecutionTarget` would coerce a stored
     * `sandbox` back to `none`, stripping the agent's runnable device target.
     */
    sandboxAvailable: isHeterogeneousSandboxExecutionAvailable(heteroType),
    select,
    /** A fixed workspace target, or a member who may not change it, keeps the place as it is. */
    switchable,
    target,
    /** The machine a device or local run works on; none for the sandbox. */
    machineDeviceId:
      target === 'device'
        ? agencyConfig?.boundDeviceId
        : target === 'local'
          ? (currentDeviceId ?? agencyConfig?.boundDeviceId)
          : undefined,
  };
};
