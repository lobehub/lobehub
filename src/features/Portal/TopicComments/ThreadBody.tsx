import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { MessageCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/BrandTextLoading';
import {
  useTopicCommentDetail,
  useTopicCommentReplies,
  useTopicCommentReplyCount,
} from '@/features/TopicComment/hooks';
import { mutate } from '@/libs/swr';
import { topicCommentKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import CommentCard from './CommentCard';
import Composer from './Composer';
import { styles } from './styles';
import { resolveTopicCommentThreadState } from './threadState';
import { useTopicCommentEvents } from './useTopicCommentEvents';

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
  const refresh = useCallback(async () => {
    if (!topicId) return;
    await Promise.all([
      rootMutate(),
      hasFocusedReply ? focusedReplyMutate() : Promise.resolve(),
      repliesReload(),
      mutate(topicCommentKeys.summary(topicId)),
    ]);
  }, [focusedReplyMutate, hasFocusedReply, repliesReload, rootMutate, topicId]);
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

    requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [focusedReply.data, replies.items, root.data, view?.focusCommentId]);

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
    return <Loading debugId="TopicCommentThreadPortal" />;
  }
  if (!root.data) return null;

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
        <Text fontSize={12} style={{ marginTop: 16 }} type={'secondary'} weight={500}>
          {t('topicComment.repliesTitle')}
        </Text>
        {visibleReplies.map((reply) => (
          <CommentCard
            replyStyle
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
        parentCommentId={root.data.id}
        rootReplyCount={replyCount}
        topicId={view.topicId}
        onCreated={() => void replies.reload()}
      />
    </Flexbox>
  );
});

export default ThreadBody;
