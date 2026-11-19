import { useCallback, useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { type PendingNewTopicDirectory as Draft } from '@/store/chat/slices/topic/initialState';

const sameDraft = (a: Draft | undefined, b: Draft | undefined) =>
  a?.agentId === b?.agentId &&
  a?.projectWorkingDirectoryId === b?.projectWorkingDirectoryId &&
  a?.projectId === b?.projectId;

/** Clear the staged draft when it is still this one. */
const withdraw = (own: Draft | undefined) => {
  if (!own) return;
  const { pendingNewTopicDirectory, setPendingNewTopicDirectory } = useChatStore.getState();
  if (sameDraft(pendingNewTopicDirectory, own)) setPendingNewTopicDirectory();
};

/**
 * Keep this pane's blank draft staged for the send.
 *
 * The send reads one global `pendingNewTopicDirectory`, but desktop split view
 * mounts a router per pane. Each pane therefore owns its draft (from its route)
 * and re-stages it whenever it mounts or the user interacts with it, so a draft
 * opened in another pane can't make this one send to the wrong agent/device.
 * A device switch in this pane's composer restages the global value; the pane
 * follows it while it stays on the same agent and project.
 *
 * Leaving the draft — the pane unmounts or its route no longer names one —
 * withdraws it while it is still the staged one. Left behind, it outlived the
 * draft: the agent's next blank conversation anywhere sent into this project
 * and offered its environment. Another pane's staged draft is left alone.
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
    if (!draft) withdraw(ownRef.current);
    ownRef.current = draft;
    restage();
  }, [draft?.agentId, draft?.projectWorkingDirectoryId, draft?.projectId, restage]);

  useEffect(() => () => withdraw(ownRef.current), []);

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
            !!pending.projectWorkingDirectoryId &&
            directoryIdsRef.current.has(pending.projectWorkingDirectoryId)
          )
            ownRef.current = pending;
        },
      ),
    [],
  );

  return restage;
};
