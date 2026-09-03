import type { DocumentCommentItem, DocumentCommentThread } from '@lobechat/types';
import { Center, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { documentCommentService } from '@/services/documentComment';

import CommentCard from './CommentCard';
import Composer from './Composer';
import {
  useDocumentCommentDetail,
  useDocumentCommentReplies,
  useOptimisticDocumentComment,
} from './hooks';
import type { DocumentCommentSubmitInput, DocumentCommentUpdateHandler } from './optimistic';
import {
  appendOptimisticReply,
  isOptimisticDocumentComment,
  removeOptimisticReply,
  replaceOptimisticReply,
  replaceReplyComment,
} from './optimistic';
import { styles } from './styles';
import { useAutoLoadReplies } from './useAutoLoadReplies';
import type {
  DocumentCommentFocus,
  DocumentCommentFocusMissReason,
} from './useDocumentCommentDeepLink';

interface ThreadProps extends DocumentCommentThread {
  documentId: string;
  /** Deep-link target inside this thread; forces replies to load and highlights the card. */
  focus?: DocumentCommentFocus;
  /** The deep-linked reply is gone from this thread ('missing') or could not be loaded ('failed'). */
  onFocusMissing?: (reason: DocumentCommentFocusMissReason) => void;
  onMutated: () => void | Promise<void>;
  onReplyCountChange: (rootCommentId: string, delta: number) => void | Promise<unknown>;
  onRootUpdate: DocumentCommentUpdateHandler;
  onSummaryChange: (delta: number) => void | Promise<unknown>;
}

const Thread = memo<ThreadProps>(
  ({
    documentId,
    focus,
    onFocusMissing,
    onMutated,
    onReplyCountChange,
    onRootUpdate,
    onSummaryChange,
    replyCount,
    root,
  }) => {
    const { t } = useTranslation('file');
    const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
    const { containerRef, shouldLoad } = useAutoLoadReplies(replyCount > 0);
    const focusedReplyId = focus && focus.commentId !== root.id ? focus.commentId : undefined;
    const replies = useDocumentCommentReplies(
      root.id,
      shouldLoad || Boolean(replyTargetId) || Boolean(focusedReplyId),
    );
    const createOptimistic = useOptimisticDocumentComment();
    const mutateReplies = replies.mutate;
    const reloadReplies = replies.reload;
    // The linked reply is fetched by id and shown first until it appears on a loaded page
    // (replies are oldest-first). It lives in its own cache entry, so thread refreshes
    // revalidate it too — a deleted pinned reply must not linger.
    const hasFocusedReply =
      Boolean(focusedReplyId) && replies.items.some((item) => item.id === focusedReplyId);
    const focusedReply = useDocumentCommentDetail(hasFocusedReply ? undefined : focusedReplyId);
    const mutateFocusedReply = focusedReply.mutate;
    const refreshThread = useCallback(async () => {
      // A post-delete 404 on the detail entry flows through `isNotFound`; it is not a failure.
      await Promise.all([
        reloadReplies(),
        mutateFocusedReply().catch(() => undefined),
        onMutated(),
      ]);
    }, [mutateFocusedReply, onMutated, reloadReplies]);
    // Reply edits patch the paginated cache; mirror them into the pinned detail entry too.
    const patchFocusedReply = useCallback(
      (next: DocumentCommentItem) =>
        mutateFocusedReply(
          (current) => (current && current.id === next.id ? { ...current, ...next } : current),
          { revalidate: false },
        ),
      [mutateFocusedReply],
    );
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
        await Promise.all([
          mutateReplies((pages) => appendOptimisticReply(pages, optimisticComment), {
            revalidate: false,
          }),
          onReplyCountChange(root.id, 1),
          onSummaryChange(1),
        ]);

        let created: Awaited<ReturnType<typeof documentCommentService.create>>;
        try {
          created = await documentCommentService.create({
            clientId,
            content,
            documentId: replyTarget.documentId,
            editorData,
            parentCommentId: replyTarget.id,
          });
          if (!created) throw new Error('Document comment reply creation returned no result');
        } catch (error) {
          await Promise.all([
            mutateReplies((pages) => removeOptimisticReply(pages, clientId), {
              revalidate: false,
            }),
            onReplyCountChange(root.id, -1),
            onSummaryChange(-1),
          ]);
          throw error;
        }

        try {
          await mutateReplies((pages) => replaceOptimisticReply(pages, created.comment), {
            revalidate: false,
          });
        } catch (error) {
          console.error('Failed to reconcile the created document comment reply', error);
          void reloadReplies();
        }
        if (created.isDuplicate) void refreshThread();
      },
      [
        createOptimistic,
        mutateReplies,
        onReplyCountChange,
        onSummaryChange,
        refreshThread,
        reloadReplies,
        replyTargetId,
        root,
        visibleReplies,
      ],
    );
    const handleReplyUpdate: DocumentCommentUpdateHandler = useCallback(
      async (comment, value) => {
        const optimisticComment = { ...comment, ...value, updatedAt: new Date() };
        await Promise.all([
          mutateReplies((pages) => replaceReplyComment(pages, optimisticComment), {
            revalidate: false,
          }),
          patchFocusedReply(optimisticComment),
        ]);

        let updated: Awaited<ReturnType<typeof documentCommentService.update>>;
        try {
          updated = await documentCommentService.update({ ...value, id: comment.id });
          if (!updated) throw new Error('Document comment reply update returned no result');
        } catch (error) {
          await Promise.all([
            mutateReplies((pages) => replaceReplyComment(pages, comment), {
              revalidate: false,
            }),
            patchFocusedReply(comment),
          ]);
          throw error;
        }

        try {
          await Promise.all([
            mutateReplies((pages) => replaceReplyComment(pages, updated), {
              revalidate: false,
            }),
            patchFocusedReply(updated),
          ]);
        } catch (error) {
          console.error('Failed to reconcile the updated document comment reply', error);
          void reloadReplies();
        }
      },
      [mutateReplies, patchFocusedReply, reloadReplies],
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
          focusToken={focusedReplyId === reply.id ? focus?.token : undefined}
          replying={replyTargetId === reply.id}
          variant={'reply'}
          onMutated={refreshThread}
          onReply={() => toggleReplyTarget(reply.id)}
          onUpdate={handleReplyUpdate}
        />
        {replyTargetId === reply.id && (
          <Composer
            documentId={documentId}
            key={`reply:${reply.id}`}
            parentCommentId={reply.id}
            onSubmit={handleReplySubmit}
            onSuccess={() => setReplyTargetId(null)}
          />
        )}
      </Fragment>
    );

    return (
      <Flexbox className={styles.thread} ref={containerRef}>
        <CommentCard
          comment={root}
          focusToken={focus && focus.commentId === root.id ? focus.token : undefined}
          replying={replyTargetId === root.id}
          onMutated={onMutated}
          onReply={() => toggleReplyTarget(root.id)}
          onUpdate={onRootUpdate}
        />

        {(replyCount > 0 || replyTargetId || focusedReplyId) && (
          <Flexbox className={styles.replyList}>
            {replyTargetId === root.id && (
              <Composer
                documentId={documentId}
                key={`reply:${root.id}`}
                parentCommentId={root.id}
                onSubmit={handleReplySubmit}
                onSuccess={() => setReplyTargetId(null)}
              />
            )}
            {pinnedReply && renderReply(pinnedReply)}
            {replies.isLoadingInitial && replyCount > 0 ? (
              <SurfaceSkeleton header={false} variant={'list'} />
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
