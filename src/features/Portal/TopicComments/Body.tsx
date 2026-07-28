import { Center, Empty, Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { MessageCircle } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Loading from '@/components/Loading/BrandTextLoading';
import { useTopicCommentThreads } from '@/features/TopicComment/hooks';
import { mutate } from '@/libs/swr';
import { topicCommentKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import CommentCard from './CommentCard';
import Composer from './Composer';
import { styles } from './styles';
import { useTopicCommentEvents } from './useTopicCommentEvents';

const Body = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.topicCommentsView);
  const openThread = useChatStore((s) => s.openTopicCommentThread);
  const {
    error,
    hasMore,
    isInitialError,
    isLoadingInitial,
    isLoadingMore,
    isRetrying,
    items,
    loadMore,
    pendingCommentIds,
    reload,
  } = useTopicCommentThreads(view?.topicId, view?.messageId);
  const topicId = view?.topicId;
  const refresh = useCallback(
    () =>
      topicId
        ? Promise.all([reload(), mutate(topicCommentKeys.summary(topicId))]).then(() => undefined)
        : Promise.resolve(),
    [reload, topicId],
  );
  useTopicCommentEvents(topicId, refresh);

  if (!view) return null;
  if (isInitialError) {
    return (
      <Flexbox className={styles.body}>
        <AsyncError error={error} variant={'page'} onRetry={() => void reload()} />
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.body}>
      <Flexbox className={styles.list}>
        {isLoadingInitial ? (
          <Loading debugId="TopicCommentsPortal" />
        ) : items.length === 0 ? (
          <Center className={styles.empty}>
            <Empty description={t('topicComment.empty')} icon={MessageCircle} />
          </Center>
        ) : (
          items.map(({ replyCount, root }) => {
            const pending = pendingCommentIds.has(root.id);
            return (
              <CommentCard
                comment={root}
                key={root.id}
                pending={pending}
                replyCount={replyCount}
                onMutated={() => void reload()}
                onOpenThread={
                  pending ? undefined : () => openThread(view.topicId, root.id, root, replyCount)
                }
              />
            );
          })
        )}
        {error ? (
          <AsyncError
            error={error}
            retrying={isRetrying}
            variant={'inline'}
            onRetry={() => void reload()}
          />
        ) : (
          hasMore && (
            <Center paddingBlock={12}>
              <Button loading={isLoadingMore} type={'text'} onClick={() => void loadMore()}>
                {t('topicComment.loadMore')}
              </Button>
            </Center>
          )
        )}
      </Flexbox>
      <Composer messageId={view.messageId} topicId={view.topicId} onCreated={() => void reload()} />
    </Flexbox>
  );
});

export default Body;
