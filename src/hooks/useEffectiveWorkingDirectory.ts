import { isDesktop } from '@lobechat/const';

import {
  resolveAgentWorkingDirectory,
  resolveTargetDeviceId,
} from '@/helpers/agentWorkingDirectory';
import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';

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
  useDeviceStore((s) => s.useFetchDevices)();

  const agencyConfig = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgencyConfigById(agentId)(s) : undefined,
  );
  const legacyAgentWorkingDirectory = useAgentStore((s) =>
    agentId ? s.localAgentWorkingDirectoryMap[agentId] : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
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
  });
};
