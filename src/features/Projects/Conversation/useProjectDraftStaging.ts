import { useCallback, useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';

interface Draft {
  agentId: string;
  projectWorkingDirectoryId: string;
}

const sameDraft = (a: Draft | undefined, b: Draft | undefined) =>
  a?.agentId === b?.agentId && a?.projectWorkingDirectoryId === b?.projectWorkingDirectoryId;

/**
 * Keep this pane's blank draft staged for the send.
 *
 * The send reads one global `pendingNewTopicDirectory`, but desktop split view
 * mounts a router per pane. Each pane therefore owns its draft (from its route)
 * and re-stages it whenever it mounts or the user interacts with it, so a draft
 * opened in another pane can't make this one send to the wrong agent/device.
 * A device switch in this pane's composer restages the global value; the pane
 * follows it while it stays on the same agent and project.
 */
export const useProjectDraftStaging = (
  draft: Draft | undefined,
  projectDirectoryIds: ReadonlySet<string>,
) => {
  const ownRef = useRef(draft);
  const directoryIdsRef = useRef(projectDirectoryIds);
  directoryIdsRef.current = projectDirectoryIds;

  const restage = useCallback(() => {
    const own = ownRef.current;
    if (!own) return;
    const { pendingNewTopicDirectory, setPendingNewTopicDirectory } = useChatStore.getState();
    if (!sameDraft(pendingNewTopicDirectory, own)) setPendingNewTopicDirectory(own);
  }, []);

  useEffect(() => {
    ownRef.current = draft;
    restage();
  }, [draft?.agentId, draft?.projectWorkingDirectoryId, restage]);

  useEffect(
    () =>
      useChatStore.subscribe(
        (s) => s.pendingNewTopicDirectory,
        (pending) => {
          const own = ownRef.current;
          if (
            own &&
            pending &&
            pending.agentId === own.agentId &&
            directoryIdsRef.current.has(pending.projectWorkingDirectoryId)
          )
            ownRef.current = pending;
        },
      ),
    [],
  );

  return restage;
};
