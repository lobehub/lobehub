import { useMemo } from 'react';

import { type ChatStoreState, useChatStore } from '@/store/chat';
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
 * The staged directory of the blank conversation `agentId` / `topicId`
 * describes — see `useStagedProjectDirectoryId`. Shared with the welcome
 * screen, which reads its ids from the conversation rather than the composer.
 */
export const stagedProjectDirectoryIdSelector =
  (agentId: string | undefined, topicId: string | null | undefined) =>
  (s: ChatStoreState): string | undefined => {
    const pending = s.pendingNewTopicDirectory;
    return agentId && !topicId && pending?.agentId === agentId
      ? pending.projectWorkingDirectoryId
      : undefined;
  };

/**
 * The project directory a blank conversation was opened in by a project
 * group's "+" (`pendingNewTopicDirectory`). Its first send binds the new topic
 * there, so until then the composer has to show that directory rather than
 * the agent's default device and path. Undefined once the composer belongs to
 * a topic, or when the staging was made on another agent.
 */
export const useStagedProjectDirectoryId = (agentId: string): string | undefined => {
  const topicId = useTopicId();

  return useChatStore(stagedProjectDirectoryIdSelector(agentId, topicId));
};

/**
 * The staged directory of a blank conversation (see
 * `useStagedProjectDirectoryId`) and the project's other directories it may
 * move to before the first send.
 */
export const useStagedProjectDirectory = (agentId: string) => {
  const directoryId = useStagedProjectDirectoryId(agentId);
  useProjectDirectoryStore((s) => s.useFetchDirectories)(undefined, !!directoryId);
  const scopeRows = useProjectDirectories();
  const projectId = scopeRows.find((d) => d.id === directoryId)?.projectId;
  useProjectDirectoryStore((s) => s.useFetchDirectories)(projectId, !!projectId);
  const projectRows = useProjectDirectoryStore((s) =>
    projectId ? s.directoriesMap[projectId] : undefined,
  );
  // The project's own entry is the authority once loaded. Until then — or if
  // its fetch fails — the warm scope-wide rows already list the project's
  // directories, so the switcher never waits on an empty picker.
  const directories = useMemo(() => {
    if (!projectId) return EMPTY;
    return projectRows ?? scopeRows.filter((d) => d.projectId === projectId);
  }, [projectId, projectRows, scopeRows]);

  return { directories, directoryId };
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
