import type { AcceptanceCommentItem } from '@lobechat/types';
import { Empty, Flexbox } from '@lobehub/ui';
import { Avatar, Button, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useActivityTime } from '@/hooks/useActivityTime';

import { useAcceptanceScope } from '../AcceptanceScope';
import CommentContent from '../Comments/CommentContent';
import { styles } from '../Comments/styles';
import { groupCommentThreads } from '../Comments/threads';
import { useAcceptanceCommentList } from '../Comments/useAcceptanceCommentList';

export const ReadComment = ({ comment }: { comment: AcceptanceCommentItem }) => {
  const { t } = useTranslation('verify');
  const time = useActivityTime(comment.createdAt);
  const name = comment.author.fullName || comment.author.username || '—';

  return (
    <Flexbox className={styles.box} style={{ marginInlineStart: comment.parentCommentId ? 24 : 0 }}>
      <Flexbox horizontal align={'center'} className={styles.boxHeader} gap={8} wrap={'wrap'}>
        <Avatar avatar={comment.author.avatar || name.slice(0, 1)} size={20} />
        <Text weight={600}>{name}</Text>
        <Text fontSize={12} title={time.title} type={'secondary'}>
          {time.text}
        </Text>
        {comment.resolvedAt && <Text fontSize={12}>{t('acceptance.comments.resolved')}</Text>}
      </Flexbox>
      <div className={styles.body}>
        <CommentContent comment={comment} />
        {comment.reactions.length > 0 && (
          <Flexbox horizontal gap={8} style={{ paddingBlockStart: 8 }} wrap={'wrap'}>
            {comment.reactions.map((reaction) => (
              <span key={reaction.emoji}>
                {reaction.emoji} {reaction.count}
              </span>
            ))}
          </Flexbox>
        )}
      </div>
    </Flexbox>
  );
};

const ReadDiscussion = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data, error, isLoading, mutate } = useAcceptanceCommentList(acceptanceId);

  if (!data && isLoading) return <NeuralNetworkLoading size={32} />;
  if (!data && error)
    return (
      <Empty description={t('acceptance.comments.loadFailed')}>
        <Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>
      </Empty>
    );

  const items = groupCommentThreads(data?.items ?? [])
    .filter(({ root }) => !root.checkItemId)
    .flatMap(({ root, replies }) => [root, ...replies]);
  if (items.length === 0) return <Empty description={t('acceptance.comments.empty')} />;

  return (
    <Flexbox gap={16}>
      {items.map((item) => (
        <ReadComment comment={item} key={item.id} />
      ))}
    </Flexbox>
  );
};

export default ReadDiscussion;
