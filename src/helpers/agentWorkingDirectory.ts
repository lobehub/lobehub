import type {
  LobeAgentAgencyConfig,
  WorkingDirConfig,
  WorkingDirConfigValue,
} from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSourcePath } from '@lobechat/types';

interface ResolveTargetDeviceIdOptions {
  workspaceScoped?: boolean;
}

/**
 * The device a run targets: an explicitly bound remote device, this machine,
 * or (on web) a desktop-local binding synced from the desktop app.
 * Local execution treats the current machine as its own device, so local and
 * remote share one resolution model.
 */
export const resolveTargetDeviceId = (
  agencyConfig: LobeAgentAgencyConfig | undefined,
  currentDeviceId: string | undefined,
  { workspaceScoped = false }: ResolveTargetDeviceIdOptions = {},
): string | undefined => {
  if (workspaceScoped) {
    return agencyConfig?.executionTarget === 'local' ||
      agencyConfig?.executionTarget === 'device' ||
      agencyConfig?.executionTarget === 'auto'
      ? agencyConfig.boundDeviceId
      : undefined;
  }

  return agencyConfig?.executionTarget === 'device'
    ? agencyConfig?.boundDeviceId
    : agencyConfig?.executionTarget === 'local'
      ? currentDeviceId || agencyConfig?.boundDeviceId
      : currentDeviceId;
};

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
  workspaceScoped?: boolean;
}): WorkingDirConfig | undefined => {
  const {
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
    workspaceScoped,
  } = params;
  if (topicWorkingDirectoryConfig) return topicWorkingDirectoryConfig;
  if (topicWorkingDirectory) return { path: topicWorkingDirectory };

  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  const agentChoice = toWorkingDirConfig(
    targetDeviceId ? agencyConfig?.workingDirByDevice?.[targetDeviceId] : undefined,
  );
  if (agentChoice) return agentChoice;
  // Legacy + desktop/home fallbacks belong to the current member's machine.
  // They are invalid when an unoverridden workspace config routes to a shared
  // device (or sandbox), where only shared/device-scoped paths are meaningful.
  if (!workspaceScoped && legacyAgentWorkingDirectory) return { path: legacyAgentWorkingDirectory };
  if (deviceDefaultCwd) return { path: deviceDefaultCwd };
  if (!workspaceScoped && fallback) return { path: fallback };
};

export const resolveAgentWorkingDirectory = (
  params: Parameters<typeof resolveAgentWorkingDirectoryConfig>[0],
): string | undefined => {
  const config = resolveAgentWorkingDirectoryConfig(params);
  return getWorkingDirEffectivePath(config);
};

/**
 * Same precedence as {@link resolveAgentWorkingDirectory}, but resolves to the
 * SOURCE repo path (`config.path`) — the repo root, ignoring any active
 * worktree recorded in `config.git.activeWorktree`.
 *
 * Use this for the directory-picker DISPLAY, which shows the repo the agent is
 * bound to. The effective (worktree) path belongs to git status / the worktree
 * switcher, not the directory label: heterogeneous CLI agents anchor their
 * session cwd to the source repo (see `conversationLifecycle`), so showing the
 * worktree here would misrepresent where the run actually executes.
 */
export const resolveAgentWorkingDirectorySource = (
  params: Parameters<typeof resolveAgentWorkingDirectoryConfig>[0],
): string | undefined => {
  const config = resolveAgentWorkingDirectoryConfig(params);
  return getWorkingDirSourcePath(config);
};
