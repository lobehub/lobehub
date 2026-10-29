import { isDesktop } from '@lobechat/const';
import type { DeviceListItem } from '@lobechat/types';
import { useMemo } from 'react';

import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { canHostTerminal, deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

import { useChatTerminalStore } from './store';
import { LOCAL_TARGET, resolveTerminalCwd, resolveTerminalDevice } from './targetOptions';

interface TerminalTarget {
  /** Whether the next shell's target is final, so the first one may open */
  canSpawn: boolean;
  /** Directory a shell opened on the current target starts in */
  cwd?: string;
  /** Point the topic at another target (`LOCAL_TARGET` for this machine) and open a shell there */
  selectTarget: (next: string) => void;
  /** Where the next shell runs; `undefined` is this machine */
  targetDeviceId?: string;
  /** Devices that can host a terminal right now */
  targets: DeviceListItem[];
}

/**
 * Where a topic's terminals open and which directory they start in.
 *
 * The default follows the device the conversation runs on — the same
 * resolution the chat input's device picker shows — so the shell lands next to
 * the agent's files. A pick in the terminal's own picker overrides it.
 */
export const useTerminalTarget = (topicKey: string, agentId?: string): TerminalTarget => {
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const createTab = useChatTerminalStore((s) => s.createTab);
  const devicePick = useChatTerminalStore((s) => s.devicePickByTopic[topicKey]);
  const setTerminalDevice = useChatTerminalStore((s) => s.setTerminalDevice);

  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);
  const executionTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero: !!agencyConfig?.heterogeneousProvider?.type,
    workspaceScoped,
  });
  const boundDeviceId = executionTarget === 'device' ? agencyConfig?.boundDeviceId : undefined;
  // Bound to this very desktop: its own PTY is the same machine, minus a gateway hop.
  const topicDeviceId = isDesktop && boundDeviceId === currentDeviceId ? undefined : boundDeviceId;

  // The panel shell only fetches the list on the web; desktop needs it here to
  // follow a topic bound to a remote device.
  const { error: deviceListError } = useDeviceStore((s) => s.useFetchDevices)(true);
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const deviceListConfirmed = useDeviceStore(deviceSelectors.isDeviceListConfirmed);
  // Only devices that can actually open a shell. An offline row, or one whose
  // live connections are all desktop ones, answers a terminal RPC with a
  // refusal — offering it would fail the session the moment it is claimed.
  const targets = useMemo(() => devices.filter(canHostTerminal), [devices]);
  const { deviceId: targetDeviceId, ready: canSpawn } = resolveTerminalDevice({
    configLoading: isPreferenceLoading,
    listSettled: deviceListConfirmed || !!deviceListError,
    localAvailable: isDesktop,
    pick: devicePick,
    targets,
    topicDeviceId,
  });

  const effectiveWorkingDirectory = useEffectiveWorkingDirectory(agentId);
  const workingDirectoryDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  // Subscribed so `cwd` follows edits to the target's default directory.
  const targetDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(targetDeviceId));
  const cwdFor = (deviceId: string | undefined, deviceDefaultCwd?: string | null) =>
    resolveTerminalCwd({
      deviceDefaultCwd,
      terminalDeviceId: deviceId ?? currentDeviceId,
      workingDirectory: effectiveWorkingDirectory,
      workingDirectoryDeviceId,
    });

  /**
   * Existing shells keep running where they started, so open one on the new
   * target — otherwise picking a device looks like it did nothing.
   */
  const selectTarget = (next: string) => {
    const deviceId = next === LOCAL_TARGET ? undefined : next;
    setTerminalDevice(topicKey, deviceId);
    // `cwd` belongs to the previous target until the next render, so resolve
    // the directory for the device being switched to.
    const nextDefaultCwd = deviceSelectors.getDeviceDefaultCwd(deviceId)(useDeviceStore.getState());
    void createTab(topicKey, cwdFor(deviceId, nextDefaultCwd), deviceId);
  };

  return {
    canSpawn,
    cwd: cwdFor(targetDeviceId, targetDefaultCwd),
    selectTarget,
    targetDeviceId,
    targets,
  };
};
