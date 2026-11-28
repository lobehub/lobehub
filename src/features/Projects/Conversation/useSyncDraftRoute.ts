import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { useChatStore } from '@/store/chat';
import { type PendingNewTopicDirectory as Draft } from '@/store/chat/slices/topic/initialState';

/**
 * Keep a blank draft's route in step with where its composer staged it: the
 * folder (`dir`) and the automatic choice (`auto`). The route is what a
 * reload rebuilds the draft from, so a hand pick made in the picker — or a
 * move Auto made — must not be undone by the next reload.
 */
export const useSyncDraftRoute = ({
  draft,
  directoryIds,
  projectId,
}: {
  directoryIds: ReadonlySet<string>;
  draft: Draft | undefined;
  /** The draft's project, once confirmed. */
  projectId: string | undefined;
}) => {
  const [, setSearchParams] = useSearchParams();
  const scopeRef = useRef({ directoryIds, draft, projectId });
  scopeRef.current = { directoryIds, draft, projectId };

  useEffect(
    () =>
      useChatStore.subscribe(
        (s) => s.pendingNewTopicDirectory,
        (pending) => {
          const { directoryIds, draft, projectId } = scopeRef.current;
          if (!draft || !pending || pending.agentId !== draft.agentId) return;
          const ours = pending.projectWorkingDirectoryId
            ? directoryIds.has(pending.projectWorkingDirectoryId)
            : !!projectId && pending.projectId === projectId;
          if (!ours) return;
          if (
            pending.projectWorkingDirectoryId === draft.projectWorkingDirectoryId &&
            !!pending.auto === !!draft.auto
          )
            return;
          setSearchParams(
            (params) => {
              const next = new URLSearchParams(params);
              if (pending.projectWorkingDirectoryId)
                next.set('dir', pending.projectWorkingDirectoryId);
              else next.delete('dir');
              if (pending.auto) next.set('auto', '1');
              else next.delete('auto');
              return next;
            },
            { replace: true },
          );
        },
      ),
    [setSearchParams],
  );
};
