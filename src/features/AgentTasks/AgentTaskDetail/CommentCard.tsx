import type { TaskDetailActivity } from '@lobechat/types';
import { Block, cssVar, Flexbox } from '@lobehub/ui';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { isOptimisticActivityId } from '@/store/task/slices/detail/optimisticActivity';

import { styles } from '../shared/style';
import CommentInput from './CommentInput';
import CommentItem from './CommentItem';

interface CommentCardProps {
  activity: TaskDetailActivity;
  /** The thread's replies, oldest first. */
  replies?: TaskDetailActivity[];
  taskId?: string;
}

/**
 * A comment thread, the way an issue tracker shows one: the top-level comment,
 * its replies beneath a hairline, and a reply box at the bottom. The reply box
 * stays out of the way until the thread has replies — or somebody asks to
 * reply — so a feed of single comments stays quiet.
 */
const CommentCard = memo<CommentCardProps>(({ activity, replies = [], taskId }) => {
  const { t } = useTranslation('chat');
  const { allowed: canComment } = usePermission('create_content');
  const [replying, setReplying] = useState(false);
  const rootId = activity.id;
  const canReply =
    canComment && Boolean(taskId) && Boolean(rootId) && !isOptimisticActivityId(rootId);
  const hasReplies = replies.length > 0;

  const openReply = useCallback(() => setReplying(true), []);
  const closeReply = useCallback(() => setReplying(false), []);

  return (
    <Block
      gap={12}
      paddingBlock={12}
      paddingInline={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
    >
      <CommentItem
        activity={activity}
        replyCount={replies.length}
        onReply={canReply ? openReply : undefined}
      />
      {(hasReplies || (canReply && replying)) && (
        <Flexbox className={styles.commentReplies} gap={12}>
          {replies.map((reply, i) => (
            <CommentItem isReply activity={reply} key={reply.id ?? `reply-${i}`} />
          ))}
          {canReply && (hasReplies || replying) && (
            <CommentInput
              autoFocus={replying}
              parentCommentId={rootId!}
              placeholder={t('taskDetail.comment.replyPlaceholder')}
              taskId={taskId!}
              onCancel={hasReplies ? undefined : closeReply}
              onSubmitted={closeReply}
            />
          )}
        </Flexbox>
      )}
    </Block>
  );
});

CommentCard.displayName = 'TaskCommentCard';

export default CommentCard;
