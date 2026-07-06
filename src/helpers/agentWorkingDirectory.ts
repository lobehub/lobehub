import type {
  LobeAgentAgencyConfig,
  WorkingDirConfig,
  WorkingDirConfigValue,
} from '@lobechat/types';
import { getWorkingDirEffectivePath } from '@lobechat/types';

/**
 * The device a run targets: an explicitly bound remote device, this machine,
 * or (on web) a desktop-local binding synced from the desktop app.
 * Local execution treats the current machine as its own device, so local and
 * remote share one resolution model.
 */
export const resolveTargetDeviceId = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  currentDeviceId: string | undefined,
): string | undefined =>
  agencyConfig?.executionTarget === 'device'
    ? agencyConfig?.boundDeviceId
    : agencyConfig?.executionTarget === 'local'
      ? currentDeviceId || agencyConfig?.boundDeviceId
      : currentDeviceId;

const toWorkingDirConfig = (
  value: WorkingDirConfigValue | null | undefined,
): WorkingDirConfig | undefined => {
  if (!value) return;
  return typeof value === 'string' ? { path: value } : value;
};

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
export const resolveAgentWorkingDirectoryConfig = (params: {
  agencyConfig?: LobeAgentAgencyConfig;
  currentDeviceId?: string;
  deviceDefaultCwd?: string;
  fallback?: string;
  legacyAgentWorkingDirectory?: string;
  topicWorkingDirectory?: string;
  topicWorkingDirectoryConfig?: WorkingDirConfig;
}): WorkingDirConfig | undefined => {
  const {
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
  } = params;
  if (topicWorkingDirectoryConfig) return topicWorkingDirectoryConfig;
  if (topicWorkingDirectory) return { path: topicWorkingDirectory };

  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const agentChoice = toWorkingDirConfig(
    targetDeviceId ? agencyConfig?.workingDirByDevice?.[targetDeviceId] : undefined,
  );
  if (agentChoice) return agentChoice;
  if (legacyAgentWorkingDirectory) return { path: legacyAgentWorkingDirectory };
  if (deviceDefaultCwd) return { path: deviceDefaultCwd };
  if (fallback) return { path: fallback };
};

export const resolveAgentWorkingDirectory = (
  params: Parameters<typeof resolveAgentWorkingDirectoryConfig>[0],
): string | undefined => {
  const config = resolveAgentWorkingDirectoryConfig(params);
  return getWorkingDirEffectivePath(config);
};
