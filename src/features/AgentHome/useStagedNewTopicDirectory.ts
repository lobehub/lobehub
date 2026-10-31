import { stagedProjectDirectoryIdSelector } from '@/features/ChatInput/ControlBar/useProjectTopicDirectory';
import { contextSelectors, useConversationStore } from '@/features/Conversation/store';
import { useChatStore } from '@/store/chat';
import {
  type ProjectDirectory,
  useProjectDirectories,
  useProjectDirectoryStore,
} from '@/store/projectWorkingDirectory';

/**
 * The project directory this welcome's blank conversation was opened in by a
 * project device group's "+", or undefined for any other conversation. Its
 * ids come from the conversation, not the composer, since the welcome sits
 * outside the ChatInput.
 */
export const useStagedNewTopicDirectory = (): ProjectDirectory | undefined => {
  const agentId = useConversationStore(contextSelectors.agentId);
  const topicId = useConversationStore(contextSelectors.topicId);
  const directoryId = useChatStore(stagedProjectDirectoryIdSelector(agentId, topicId));
  useProjectDirectoryStore((s) => s.useFetchDirectories)(undefined, !!directoryId);
  const directories = useProjectDirectories();

  return directoryId ? directories.find((d) => d.id === directoryId) : undefined;
};
