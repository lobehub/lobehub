import { isDesktop } from '@lobechat/const';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type ChatStoreState } from '@/store/chat/initialState';
import { topicSelectors } from '@/store/chat/selectors';
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
 */
export const resolveEffectiveWorkingDirectory = (
  chatState: ChatStoreState,
  topicId?: string | null,
): string | undefined => {
  if (!isDesktop) return undefined;

  const topicWorkingDir = topicSelectors.getTopicWorkingDirectory(topicId)(chatState);
  if (topicWorkingDir) return topicWorkingDir;

  const currentDeviceId = getElectronStoreState().gatewayDeviceInfo?.deviceId;
  return (
    agentSelectors.currentAgentWorkingDirectory(currentDeviceId)(getAgentStoreState()) ?? undefined
  );
};
