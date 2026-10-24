import type { DocumentCommentItem, DocumentCommentThread } from '@lobechat/types';
import { Button, Center, cx, Flexbox, Skeleton } from '@lobehub/ui';
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { documentCommentActions } from '@/store/documentComment';

import CommentCard from './CommentCard';
import Composer from './Composer';
import {
  handleDocumentCommentUpdate,
  useDocumentCommentDetail,
  useDocumentCommentReplies,
  useOptimisticDocumentComment,
} from './hooks';
import type { DocumentCommentSubmitInput } from './optimistic';
import { isOptimisticDocumentComment } from './optimistic';
import { styles } from './styles';
import { useAutoLoadReplies } from './useAutoLoadReplies';
import type {
  DocumentCommentFocus,
  DocumentCommentFocusMissReason,
} from './useDocumentCommentDeepLink';

interface ThreadProps extends DocumentCommentThread {
  /** Narrow-column layout for a thread in the gutter. */
  compact?: boolean;
  documentId: string;
  /** Deep-link target inside this thread; forces replies to load and highlights the card. */
  focus?: DocumentCommentFocus;
  /** The deep-linked reply is gone from this thread ('missing') or could not be loaded ('failed'). */
  onFocusMissing?: (reason: DocumentCommentFocusMissReason) => void;
  onMutated: () => void | Promise<void>;
}

/** At most this many placeholder rows while a thread's replies load. */
const REPLY_SKELETON_MAX = 3;

/**
 * Placeholder rows shaped like the replies they stand in for — one per
 * expected reply, capped — rather than a generic five-card list that towers
 * over a thread with a single answer.
 */
const ReplySkeleton = memo<{ compact: boolean; count: number }>(({ compact, count }) => (
  <Flexbox gap={compact ? 12 : 16} paddingBlock={compact ? 4 : 8}>
    {Array.from({ length: Math.min(Math.max(count, 1), REPLY_SKELETON_MAX) }).map((_, index) => (
      <Flexbox gap={8} key={index}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Skeleton height={28} radius={14} width={28} />
          <Skeleton height={14} width={96 + (index % 2) * 24} />
        </Flexbox>
        <Skeleton height={14} width={`${48 + (index % 3) * 14}%`} />
      </Flexbox>
    ))}
  </Flexbox>
));

ReplySkeleton.displayName = 'DocumentCommentReplySkeleton';

const Thread = memo<ThreadProps>(
  ({ compact = false, documentId, focus, onFocusMissing, onMutated, replyCount, root }) => {
    const { t } = useTranslation('file');
    const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
    const { containerRef, shouldLoad } = useAutoLoadReplies(replyCount > 0);
    const focusedReplyId = focus && focus.commentId !== root.id ? focus.commentId : undefined;
    // Once the replies have been asked for they stay subscribed. Closing the
    // reply box after sending would otherwise drop the key for a render or
    // two (until the auto-load observer catches up), which empties the list,
    // discards the optimistic reply on screen, and brings the skeleton back
    // while the server page is refetched.
    const wantsReplies = shouldLoad || Boolean(replyTargetId) || Boolean(focusedReplyId);
    const [repliesLatched, setRepliesLatched] = useState(wantsReplies);
    useEffect(() => {
      if (wantsReplies) setRepliesLatched(true);
    }, [wantsReplies]);
    const replies = useDocumentCommentReplies(root.id, wantsReplies || repliesLatched);
    const createOptimistic = useOptimisticDocumentComment();
    const reloadReplies = replies.reload;
    // The linked reply is fetched by id and shown first until it appears on a loaded page
    // (replies are oldest-first). It lives in its own replica entry, so thread refreshes
    // revalidate it too — a deleted pinned reply must not linger.
    const hasFocusedReply =
      Boolean(focusedReplyId) && replies.items.some((item) => item.id === focusedReplyId);
    const focusedReply = useDocumentCommentDetail(hasFocusedReply ? undefined : focusedReplyId);
    const pinnedReplyId = hasFocusedReply ? undefined : focusedReplyId;
    const refreshThread = useCallback(async () => {
      // A post-delete 404 on the detail entry flows through `isNotFound`; it is not a failure.
      await Promise.all([
        reloadReplies(),
        pinnedReplyId ? documentCommentActions.revalidateDetail(pinnedReplyId) : undefined,
        onMutated(),
      ]);
    }, [onMutated, pinnedReplyId, reloadReplies]);
    // The deep-link target while it is not on a loaded page. It renders on its own, so a
    // pending or failed page request never hides a reply that was already fetched.
    const pinnedReply = useMemo(() => {
      const pinned = focusedReply.data;
      if (!pinned || hasFocusedReply || pinned.parentCommentId !== root.id) return undefined;
      return pinned;
    }, [focusedReply.data, hasFocusedReply, root.id]);
    // Everything a reply action can target: the pinned reply plus the loaded pages.
    const visibleReplies = useMemo(
      () => (pinnedReply ? [pinnedReply, ...replies.items] : replies.items),
      [pinnedReply, replies.items],
    );
    const handleReplySubmit = useCallback(
      async ({ clientId, content, editorData }: DocumentCommentSubmitInput) => {
        const replyTarget =
          replyTargetId === root.id
            ? root
            : visibleReplies.find((item) => item.id === replyTargetId);
        if (!replyTarget) throw new Error('Document comment reply target is unavailable');
        if (isOptimisticDocumentComment(replyTarget)) {
          throw new Error('An optimistic document comment cannot be replied to');
        }

        const optimisticComment = createOptimistic({
          clientId,
          content,
          documentId: replyTarget.documentId,
          editorData,
          parentCommentId: root.id,
          replyTo:
            replyTarget.id === root.id ? null : { author: replyTarget.author, id: replyTarget.id },
        });
        // A duplicate (retried) submit re-reads the thread inside the store.
        await documentCommentActions.createReply({
          input: {
            clientId,
            content,
            documentId: replyTarget.documentId,
            editorData,
            parentCommentId: replyTarget.id,
          },
          optimisticComment,
          rootCommentId: root.id,
        });
      },
      [createOptimistic, replyTargetId, root, visibleReplies],
    );

    // NOT_FOUND, or a reply from another thread, means the linked reply is gone; any other
    // lookup failure is reported so the miss is never silent.
    const isFocusedReplyMissing =
      Boolean(focusedReplyId) &&
      (focusedReply.isNotFound ||
        Boolean(focusedReply.data && focusedReply.data.parentCommentId !== root.id));
    const isFocusedReplyFailed =
      Boolean(focusedReplyId) && Boolean(focusedReply.error) && !focusedReply.isNotFound;
    useEffect(() => {
      if (isFocusedReplyMissing) onFocusMissing?.('missing');
      else if (isFocusedReplyFailed) onFocusMissing?.('failed');
    }, [isFocusedReplyFailed, isFocusedReplyMissing, onFocusMissing]);

    const toggleReplyTarget = useCallback((commentId: string) => {
      setReplyTargetId((current) => (current === commentId ? null : commentId));
    }, []);

    const renderReply = (reply: DocumentCommentItem) => (
      <Fragment key={reply.id}>
        <CommentCard
          comment={reply}
          compact={compact}
          focusScroll={focus?.scroll}
          focusToken={focusedReplyId === reply.id ? focus?.token : undefined}
          replying={replyTargetId === reply.id}
          threadAuthor={root.author}
          variant={'reply'}
          onMutated={refreshThread}
          onReply={() => toggleReplyTarget(reply.id)}
          onUpdate={handleDocumentCommentUpdate}
        />
        {replyTargetId === reply.id && (
          <Composer
            documentId={documentId}
            key={`reply:${reply.id}`}
            parentCommentId={reply.id}
            plain={compact}
            onCancel={() => setReplyTargetId(null)}
            onSubmit={handleReplySubmit}
            onSuccess={() => setReplyTargetId(null)}
          />
        )}
      </Fragment>
    );

    return (
      <Flexbox className={cx(styles.thread, compact && styles.threadCompact)} ref={containerRef}>
        <CommentCard
          comment={root}
          compact={compact}
          focusScroll={focus?.scroll}
          focusToken={focus && focus.commentId === root.id ? focus.token : undefined}
          replying={replyTargetId === root.id}
          onMutated={onMutated}
          onReply={() => toggleReplyTarget(root.id)}
          onUpdate={handleDocumentCommentUpdate}
        />

        {(replyCount > 0 || replyTargetId || focusedReplyId) && (
          <Flexbox className={cx(styles.replyList, compact && styles.replyListCompact)}>
            {replyTargetId === root.id && (
              <Composer
                documentId={documentId}
                key={`reply:${root.id}`}
                parentCommentId={root.id}
                plain={compact}
                onCancel={() => setReplyTargetId(null)}
                onSubmit={handleReplySubmit}
                onSuccess={() => setReplyTargetId(null)}
              />
            )}
            {pinnedReply && renderReply(pinnedReply)}
            {replies.isLoadingInitial && replyCount > 0 ? (
              <ReplySkeleton compact={compact} count={replyCount} />
            ) : replies.isInitialError ? (
              <AsyncError
                error={replies.error}
                variant={'inline'}
                onRetry={() => void replies.reload()}
              />
            ) : (
              replies.items.map(renderReply)
            )}
            {replies.error && !replies.isInitialError ? (
              <AsyncError
                error={replies.error}
                retrying={replies.isRetrying}
                variant={'inline'}
                onRetry={() => void replies.reload()}
              />
            ) : (
              replies.hasMore && (
                <Center paddingBlock={8}>
                  <Button
                    loading={replies.isLoadingMore}
                    size={'small'}
                    type={'text'}
                    onClick={() => void replies.loadMore()}
                  >
                    {t('pageEditor.comments.loadMoreReplies')}
                  </Button>
                </Center>
              )
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

Thread.displayName = 'DocumentCommentThread';

export default Thread;
