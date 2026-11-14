import { Button, Center, Empty, Flexbox, Skeleton } from '@lobehub/ui';
import { MessageCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import {
  useTopicCommentDetail,
  useTopicCommentReplies,
  useTopicCommentReplyCount,
} from '@/features/TopicComment/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useTopicCommentStore } from '@/store/topicComment';

import CommentCard from './CommentCard';
import Composer from './Composer';
import { styles } from './styles';
import { resolveTopicCommentThreadState } from './threadState';
import { useTopicCommentEvents } from './useTopicCommentEvents';

/** At most this many placeholder rows while the replies load. */
const REPLY_SKELETON_MAX = 3;

const ThreadBody = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.topicCommentThreadView);
  const popPortalView = useChatStore((s) => s.popPortalView);
  const root = useTopicCommentDetail(view?.rootCommentId, view?.initialRoot);
  const focusedReply = useTopicCommentDetail(
    view?.focusCommentId && view.focusCommentId !== view.rootCommentId
      ? view.focusCommentId
      : undefined,
  );
  const replies = useTopicCommentReplies(view?.rootCommentId, view?.initialReplyCount);
  const rootMutate = root.mutate;
  const hasFocusedReply = Boolean(
    view?.focusCommentId && view.focusCommentId !== view.rootCommentId,
  );
  const focusedReplyMutate = focusedReply.mutate;
  const repliesReload = replies.reload;
  const topicId = view?.topicId;
  const replyCount = useTopicCommentReplyCount(
    view?.rootCommentId,
    replies.total ?? view?.initialReplyCount ?? replies.items.length,
  );
  const revalidateSummary = useTopicCommentStore((s) => s.revalidateTopicCommentSummary);
  const refresh = useCallback(async () => {
    if (!topicId) return;
    await Promise.all([
      rootMutate(),
      hasFocusedReply ? focusedReplyMutate() : Promise.resolve(),
      repliesReload(),
      revalidateSummary(topicId),
    ]);
  }, [focusedReplyMutate, hasFocusedReply, repliesReload, revalidateSummary, rootMutate, topicId]);
  useTopicCommentEvents(topicId, refresh);
  const listRef = useRef<HTMLDivElement>(null);
  const visibleReplies = useMemo(() => {
    const focused = focusedReply.data;
    if (
      !focused ||
      focused.parentCommentId !== view?.rootCommentId ||
      replies.items.some(({ id }) => id === focused.id)
    )
      return replies.items;

    return [focused, ...replies.items];
  }, [focusedReply.data, replies.items, view?.rootCommentId]);

  useEffect(() => {
    if (!view?.focusCommentId) return;
    const target = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-topic-comment-id]') ?? [],
    ).find((element) => element.dataset.topicCommentId === view.focusCommentId);
    if (!target) return;

    // Honor reduced motion: jump to the comment instead of gliding.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }),
    );
  }, [focusedReply.data, replies.items, root.data, view?.focusCommentId]);

  // The viewer's own reply lands at the end of the list; bring it into view once it is posted.
  const lastReplyId = visibleReplies.at(-1)?.id;
  const lastReplyIsOwnPending = Boolean(lastReplyId && replies.pendingCommentIds.has(lastReplyId));
  useEffect(() => {
    if (!lastReplyIsOwnPending) return;
    const list = listRef.current;
    if (!list) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      list.scrollTo({ behavior: reduceMotion ? 'auto' : 'smooth', top: list.scrollHeight }),
    );
  }, [lastReplyId, lastReplyIsOwnPending]);

  if (!view) return null;
  const state = resolveTopicCommentThreadState({
    error: root.error,
    hasData: Boolean(root.data),
    isDeleting: root.isDeleting,
    isLoading: root.isLoading,
  });
  if (state === 'hidden') return null;
  if (state === 'notFound') {
    return (
      <Center className={styles.empty}>
        <Empty description={t('topicComment.notFound')} icon={MessageCircle} />
      </Center>
    );
  }
  if (state === 'error') {
    return (
      <Flexbox className={styles.body}>
        <AsyncError error={root.error} variant={'page'} onRetry={() => void root.mutate()} />
      </Flexbox>
    );
  }
  if (state === 'loading') {
    return <SurfaceSkeleton header={false} variant={'list'} />;
  }
  if (!root.data) return null;

  // No heading for a thread nobody has replied to: the composer already says what to do.
  const shownReplyCount = Math.max(replyCount, visibleReplies.length);
  const repliesLoading = replies.isLoadingInitial && visibleReplies.length === 0;

  return (
    <Flexbox className={styles.body}>
      <Flexbox className={styles.list} ref={listRef}>
        <CommentCard
          comment={root.data}
          replyCount={replyCount}
          onDeleted={(mode) => {
            if (mode === 'hard') popPortalView();
          }}
          onMutated={() => {
            void root.mutate();
          }}
        />
        {shownReplyCount > 0 && (
          <div className={styles.repliesDivider}>
            {t('topicComment.replies', { count: shownReplyCount })}
          </div>
        )}
        {repliesLoading && (
          <Flexbox gap={16} paddingBlock={12}>
            {Array.from({ length: Math.min(shownReplyCount, REPLY_SKELETON_MAX) }).map(
              (_, index) => (
                <Flexbox gap={8} key={index}>
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Skeleton height={24} radius={12} width={24} />
                    <Skeleton height={14} width={96 + (index % 2) * 24} />
                  </Flexbox>
                  <Skeleton height={14} width={`${48 + (index % 3) * 14}%`} />
                </Flexbox>
              ),
            )}
          </Flexbox>
        )}
        {visibleReplies.map((reply) => (
          <CommentCard
            comment={reply}
            key={reply.id}
            pending={replies.pendingCommentIds.has(reply.id)}
            rootReplyCount={replyCount}
            onMutated={() => void replies.reload()}
          />
        ))}
        {replies.error ? (
          <AsyncError
            error={replies.error}
            retrying={replies.isRetrying}
            variant={'inline'}
            onRetry={() => void replies.reload()}
          />
        ) : (
          replies.hasMore && (
            <Center paddingBlock={12}>
              <Button
                loading={replies.isLoadingMore}
                type={'text'}
                onClick={() => void replies.loadMore()}
              >
                {t('topicComment.loadMore')}
              </Button>
            </Center>
          )
        )}
      </Flexbox>
      <Composer
        autoFocus={view.initialReplyCount === 0}
        parentCommentId={root.data.id}
        rootReplyCount={replyCount}
        topicId={view.topicId}
        onCreated={() => void replies.reload()}
      />
    </Flexbox>
  );
});

export default ThreadBody;
