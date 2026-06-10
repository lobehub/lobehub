import type { LobeAgentAgencyConfig } from '@lobechat/types';

/**
 * The device a run targets: an explicitly bound device, else this machine.
 * Local execution treats the current machine as its own device, so local and
 * remote share one resolution model.
 */
export const resolveTargetDeviceId = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  currentDeviceId: string | undefined,
): string | undefined =>
  agencyConfig?.executionTarget === 'device' ? agencyConfig?.boundDeviceId : currentDeviceId;

/**
 * Unified working-directory precedence (mirrors the server's resolution):
 *
 *   topic override
 *     > agent's per-device choice (`agencyConfig.workingDirByDevice[targetDeviceId]`)
 *     > legacy per-agent localStorage value (pre-migration fallback)
 *     > device default (`device.defaultCwd`)
 *     > caller fallback (e.g. home dir for in-process runs)
 *
 * The legacy slot keeps existing desktop users' selections working until they
 * next pick a directory (which writes the new per-device map).
 */
export const resolveAgentWorkingDirectory = (params: {
  agencyConfig?: LobeAgentAgencyConfig;
  currentDeviceId?: string;
  deviceDefaultCwd?: string;
  fallback?: string;
  legacyAgentWorkingDirectory?: string;
  topicWorkingDirectory?: string;
}): string | undefined => {
  const {
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
  } = params;
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const agentChoice = targetDeviceId
    ? agencyConfig?.workingDirByDevice?.[targetDeviceId]
    : undefined;
  return (
    topicWorkingDirectory ||
    agentChoice ||
    legacyAgentWorkingDirectory ||
    deviceDefaultCwd ||
    fallback ||
    undefined
  );
};
