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

/**
 * The agent's effective working directory under the unified precedence:
 *
 *   topic override > agent's per-device choice > legacy localStorage > device
 *   default > home (desktop only).
 *
 * Combines the agent store (agencyConfig + legacy map), chat store (topic cwd),
 * device store (defaultCwd) and the current machine's deviceId. Use this instead
 * of the old `topicCwd || agentCwd` pattern so local and remote resolve the same
 * way. Returns `undefined` only on web with nothing configured.
 */
export const useEffectiveWorkingDirectory = (agentId?: string): string | undefined => {
  // Self-populate the device store (SWR dedupes by key across all callers).
  // Devices live behind an authed lambda procedure, so only fetch once signed in
  // (desktop always fetches — it relies on the local device's saved cwd).
  const isLogin = useUserStore(authSelectors.isLogin);
  useDeviceStore((s) => s.useFetchDevices)(isLogin || isDesktop);

  // Effective config = shared row + this member's device override (LOBE-11689),
  // so `resolveTargetDeviceId` targets the device THIS member's run goes to —
  // not whichever machine landed on the workspace-shared row.
  const { agencyConfig } = useEffectiveAgencyConfig(agentId);
  const legacyAgentWorkingDirectory = useAgentStore((s) =>
    agentId ? s.localAgentWorkingDirectoryMap[agentId] : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const topicWorkingDirectoryConfig = useChatStore(
    (s) => topicSelectors.currentTopicMetadata(s)?.workingDirectoryConfig,
  );
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId);
  const deviceDefaultCwd = useDeviceStore(deviceSelectors.getDeviceDefaultCwd(targetDeviceId));

  // Home is the last-resort default, desktop-only (matches the legacy selector).
  const ctx = isDesktop ? globalAgentContextManager.getContext() : undefined;
  const fallback = ctx?.desktopPath ?? ctx?.homePath;

  return resolveAgentWorkingDirectory({
    agencyConfig,
    currentDeviceId,
    deviceDefaultCwd,
    fallback,
    legacyAgentWorkingDirectory,
    topicWorkingDirectory,
    topicWorkingDirectoryConfig,
  });
};
