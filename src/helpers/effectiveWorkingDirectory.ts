import { isDesktop } from '@lobechat/const';
import { getWorkingDirEffectivePath } from '@lobechat/types';

import { getChatProjection, selectChatTopicItem } from '@/projection';
import { getAgentWorkingDirectory } from '@/store/agent';
import { type ChatStoreState } from '@/store/chat/initialState';
import { getElectronStoreState } from '@/store/electron';

/**
 * Resolve the agent's effective working directory: topic override first, then
 * the agent's per-device value. Returns an actual filesystem path, or
 * `undefined` when nothing is configured (or off-desktop).
 *
 * This is the single source behind both the `{{workingDirectory}}` system-prompt
 * placeholder and the working-directory handed to tools, so what the prompt
 * promises matches what tools actually operate on.
 *
 * The chat state is passed IN rather than read from `useChatStore` so this stays
 * importable from inside the chat store's own module graph (e.g. the agent-run
 * transports). Importing the store instance there would create a cycle
 * (chat store → agentRun actions → transport → here → chat store) and leave the
 * action classes undefined at module-eval time.
 *
 * Pass `topicId` for async work (e.g. a streaming tool call) so the directory is
 * bound to the topic that *started* the request, not whatever topic is active
 * now — the user may switch topics mid-stream. Omit it (prompt-build time) to
 * resolve against the active topic.
 *
 * Pass `agentId` when the caller has captured a specific agent (e.g. from the
 * operation context) so the agent-level fallback resolves against the
 * request-starting agent, not the currently active one.
 */
export const resolveEffectiveWorkingDirectory = (
  chatState: ChatStoreState,
  topicId?: string | null,
  agentId?: string | null,
): string | undefined => {
  if (!isDesktop) return undefined;

  const resolvedTopicId = topicId === undefined ? chatState.activeTopicId : topicId;
  const topic = resolvedTopicId
    ? getChatProjection((scope) => selectChatTopicItem(scope, resolvedTopicId))
    : undefined;
  const topicWorkingDir = getWorkingDirEffectivePath(
    topic?.metadata?.workingDirectoryConfig ?? topic?.metadata?.workingDirectory,
  );
  if (topicWorkingDir) return topicWorkingDir;

  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  return getAgentWorkingDirectory(agentId ?? chatState.activeAgentId, currentDeviceId);
};
