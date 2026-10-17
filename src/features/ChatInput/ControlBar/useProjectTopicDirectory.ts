import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import {
  type ProjectDirectory,
  useProjectDirectories,
  useProjectDirectoryStore,
} from '@/store/projectWorkingDirectory';

import { useTopicId } from '../hooks/useTopicId';

const EMPTY: ProjectDirectory[] = [];

/**
 * This composer's conversation id (see `useTopicId`) when it runs in a project
 * directory, otherwise undefined. Such a conversation only chooses among its
 * project's devices and shows its directory read-only, so the control bars
 * branch on this.
 */
export const useActiveProjectDirectoryTopicId = (): string | undefined => {
  const topicId = useTopicId();

  return useChatStore((s) =>
    topicId && topicSelectors.getTopicById(topicId)(s)?.projectWorkingDirectoryId
      ? topicId
      : undefined,
  );
};

/**
 * The project directory a conversation runs in, and the project's other
 * directories it may move to. Empty for conversations outside a project
 * directory — those keep the general execution-target and directory pickers.
 */
export const useProjectTopicDirectory = (topicId?: string | null) => {
  const directoryId = useChatStore((s) =>
    topicId
      ? (topicSelectors.getTopicById(topicId)(s)?.projectWorkingDirectoryId ?? undefined)
      : undefined,
  );
  const projectId = useChatStore((s) =>
    topicId && directoryId
      ? (topicSelectors.getTopicById(topicId)(s)?.projectId ?? undefined)
      : undefined,
  );
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId, !!projectId);
  // Without a project this would read the scope-wide list, so pin it empty.
  const rows = useProjectDirectories(projectId);
  const directories = projectId ? rows : EMPTY;

  return {
    directories,
    directory: directories.find((d) => d.id === directoryId),
    directoryId,
    projectId,
  };
};
