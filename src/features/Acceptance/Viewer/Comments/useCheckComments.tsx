import type { AcceptanceCommentThread } from '@lobechat/types';
import { useCallback, useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useOptionalAcceptanceScope } from '../AcceptanceScope';
import type { AcceptanceCheck } from '../Checks/types';
import { isCommentableEvidence } from '../Evidence/evidence';
import type { EvidenceOverlayMap } from '../Evidence/overlay';
import { useAcceptanceBundle, useEvidenceUrlRefresh } from '../useAcceptanceBundle';
import { canCommentOnAcceptanceEvidence } from '../visibility';
import { useAcceptanceAuthorColor } from './authorColor';
import { commentAuthorName } from './CommentCard';
import CommentThread from './CommentThread';
import { openEvidenceCommentModal } from './EvidenceCommentModal';
import { useAcceptanceComments } from './hooks';
import { threadsForCheck } from './threads';

export const useCheckComments = (check: AcceptanceCheck, proposalOverlays?: EvidenceOverlayMap) => {
  // Collaboration: threads circled on this check's evidence. Only inside the
  // viewer — the row also renders in hosts with no acceptance scope.
  const scope = useOptionalAcceptanceScope();
  const { data: bundle } = useAcceptanceBundle(scope?.acceptanceId ?? '');
  const refreshEvidenceUrl = useEvidenceUrlRefresh(scope?.acceptanceId);
  const comments = useAcceptanceComments(scope?.acceptanceId);
  const authorColor = useAcceptanceAuthorColor();
  const viewerId = useUserStore(userProfileSelectors.userId);
  /**
   * Closing a note is a verdict on it: whoever raised it may close their own,
   * and the acceptance's reviewers may close anyone's. Ownership is read from
   * the author, not from `canDelete` — that flag also turns on for a
   * moderator, and borrowing it would silently hand the same power out.
   *
   * Memoized on the identity it reads: the profile arrives after the first
   * paint, and the overlay memo below would otherwise keep handing its
   * threads the answer computed while nobody was signed in.
   */
  const canResolveThread = useCallback(
    (thread: AcceptanceCommentThread) =>
      comments.canApprove ||
      (Boolean(viewerId) && thread.root.authorUserId === viewerId && !thread.root.deletedAt),
    [comments.canApprove, viewerId],
  );
  const checkThreads = useMemo(
    () => threadsForCheck(comments.threads, check.id),
    [comments.threads, check.id],
  );
  const commentActions = {
    onDelete: comments.remove,
    onReply: (rootId: string, content: string, attachments: { fileId: string }[]) =>
      comments.create({
        attachments,
        clientId: `${rootId}:${Date.now()}`,
        content,
        contextRunId: bundle?.rounds.at(-1)?.run.id,
        parentCommentId: rootId,
      }),
    onResolve: comments.setResolved,
  };
  // A region whose evidence a later round replaced: the box has nothing left
  // to sit on, so the thread renders under the evidence with its own copy of
  // the picture instead of disappearing.
  const showsNow = new Set(check.evidence.map((item) => item.id));
  const staleThreads = checkThreads.filter(
    (thread) => thread.root.evidenceId && !showsNow.has(thread.root.evidenceId),
  );
  // Each reviewer's regions carry their own colour, so two people circling
  // the same screenshot never read as one person's notes; the marker on the
  // box opens that thread in full — replies and all.
  const commentOverlays = useMemo(() => {
    const map: EvidenceOverlayMap = new Map(proposalOverlays ?? []);
    checkThreads.forEach((thread, index) => {
      const { author, authorUserId, evidenceId, rect, content, deletedAt, time, id } = thread.root;
      if (!evidenceId || !rect || (deletedAt && thread.replies.length === 0)) return;
      const bucket = map.get(evidenceId) ?? [];
      bucket.push({
        authorAvatar: author.avatar,
        authorName: commentAuthorName(author),
        color: authorColor(authorUserId),
        comment: content,
        label: index + 1,
        panel: (
          <CommentThread
            canComment={comments.canComment}
            canResolve={canResolveThread(thread)}
            thread={thread}
            {...commentActions}
          />
        ),
        rect,
        time: time ?? undefined,
        threadId: id,
        commentIds: [id, ...thread.replies.map((reply) => reply.id)],
        resolved: Boolean(thread.root.resolvedAt),
      });
      map.set(evidenceId, bucket);
    });
    return map.size > 0 ? map : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalOverlays, checkThreads, comments.canComment, canResolveThread, authorColor]);
  const canCommentEvidence =
    canCommentOnAcceptanceEvidence(bundle, comments.canComment) &&
    Boolean(check.result) &&
    check.evidence.some(isCommentableEvidence);
  const openEvidenceComment = (initialEvidenceId?: string, initialTime?: number) =>
    openEvidenceCommentModal({
      acceptanceId: scope!.acceptanceId,
      evidence: check.evidence,
      initialTime,
      onRefreshEvidenceUrl: refreshEvidenceUrl,
      initialEvidenceId,
      onConfirm: async ({ clientId, content, evidenceId, rect, time }) => {
        await comments.create({
          anchor: { checkItemId: check.id, evidenceId, rect, time },
          clientId,
          content,
          contextRunId: bundle?.rounds.at(-1)?.run.id,
        });
        return true;
      },
    });

  return {
    comments,
    checkThreads,
    staleThreads,
    commentOverlays,
    canResolveThread,
    commentActions,
    canCommentEvidence,
    openEvidenceComment,
    refreshEvidenceUrl,
  };
};
