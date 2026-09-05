import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

const COMMENT_QUERY = 'comment';
const COMMENT_THREAD_QUERY = 'commentThread';

/** Why a deep-link target could not be landed on. */
export type DocumentCommentFocusMissReason = 'failed' | 'missing';

export interface DocumentCommentFocus {
  /** The comment to scroll to and highlight; equals `rootCommentId` for roots. */
  commentId: string;
  rootCommentId: string;
  /** Changes on every deep link so the same comment can be focused twice in a row. */
  token: number;
}

/**
 * Turns a notification deep link (`?commentThread=<root>&comment=<id>`) into a
 * focus target for the comment list and strips the query so a reload or a
 * shared URL doesn't replay it. The list itself is responsible for paging
 * for landing on the target — see `DocumentComments` / `Thread` — and calls
 * `clearFocus` (thread gone) or `focusRoot` (only the reply is gone).
 */
export const useDocumentCommentDeepLink = (documentId: string) => {
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const [focus, setFocus] = useState<(DocumentCommentFocus & { documentId: string }) | undefined>(
    undefined,
  );

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const rootCommentId = searchParams.get(COMMENT_THREAD_QUERY);
    if (!rootCommentId) return;

    const commentId = searchParams.get(COMMENT_QUERY) ?? rootCommentId;
    setFocus((current) => ({
      commentId,
      documentId,
      rootCommentId,
      token: (current?.token ?? 0) + 1,
    }));

    searchParams.delete(COMMENT_QUERY);
    searchParams.delete(COMMENT_THREAD_QUERY);
    const search = searchParams.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ''}${location.hash}`, {
      replace: true,
    });
  }, [documentId, location.hash, location.pathname, location.search, navigate]);

  const clearFocus = useCallback(() => setFocus(undefined), []);
  /** Fall back to the thread root when the linked reply itself is gone. */
  const focusRoot = useCallback(
    () =>
      setFocus(
        (current) =>
          current && { ...current, commentId: current.rootCommentId, token: current.token + 1 },
      ),
    [],
  );

  // A focus target belongs to the document it was opened on.
  return { clearFocus, focus: focus?.documentId === documentId ? focus : undefined, focusRoot };
};
