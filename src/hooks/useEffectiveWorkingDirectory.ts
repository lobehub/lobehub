import { isDesktop } from '@lobechat/const';

import {
  resolveAgentWorkingDirectory,
  resolveTargetDeviceId,
} from '@/helpers/agentWorkingDirectory';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

interface UseEffectiveWorkingDirectoryOptions {
  /**
   * Whether to fall back to the desktop/home directory when nothing is
   * configured. Turn OFF for UI affordances that should only appear once the
   * user explicitly picked a directory (e.g. the "open in IDE" header button),
   * while runtime consumers keep the fallback so tools always have a cwd.
   *
   * @default true
   */
  homeFallback?: boolean;
  topicId?: string | null;
}

/**
 * The agent's effective working directory under the unified precedence:
 *
 *   topic override > agent's per-device choice > legacy localStorage > device
 *   default > home (desktop only, unless `homeFallback` is disabled).
 *
 * Combines the agent store (agencyConfig + legacy map), chat store (topic cwd),
 * device store (defaultCwd) and the current machine's deviceId. Use this instead
 * of the old `topicCwd || agentCwd` pattern so local and remote resolve the same
 * way. Returns `undefined` only on web with nothing configured.
 */
export const useEffectiveWorkingDirectory = (
  agentId?: string,
  { homeFallback = true, topicId }: UseEffectiveWorkingDirectoryOptions = {},
): string | undefined => {
  // Self-populate the device store (SWR dedupes by key across all callers).
  // Devices live behind an authed lambda procedure, so only fetch once signed in
  // (desktop always fetches — it relies on the local device's saved cwd).
  const isLogin = useUserStore(authSelectors.isLogin);
  useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);

  // Effective config = shared row + this member's device override,
  // so `resolveTargetDeviceId` targets the device THIS member's run goes to —
  // not whichever machine landed on the workspace-shared row.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
  const legacyAgentWorkingDirectory = useAgentStore((s) =>
    agentId ? s.localAgentWorkingDirectoryMap[agentId] : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.getTopicWorkingDirectory(topicId));
  const topicWorkingDirectoryConfig = useChatStore((s) =>
    topicId
      ? topicSelectors.getTopicById(topicId)(s)?.metadata?.workingDirectoryConfig
      : topicSelectors.currentTopicMetadata(s)?.workingDirectoryConfig,
  );
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  const deviceDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(targetDeviceId));

  // Home is the last-resort default, desktop-only (matches the legacy selector).
  const ctx = isDesktop && homeFallback ? globalAgentContextManager.getContext() : undefined;
  const fallback = ctx?.desktopPath ?? ctx?.homePath;

  return resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
    workspaceScoped,
  });
};
