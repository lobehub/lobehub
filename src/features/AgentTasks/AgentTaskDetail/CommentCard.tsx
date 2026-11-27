import type { TaskDetailActivity } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { useActivityTime } from '@/hooks/useActivityTime';

import { styles as timelineStyles } from '../shared/style';
import CommentInput, { type CommentReplyRequest } from './CommentInput';
import { CommentItem } from './CommentItem';

const styles = stylex.create({
  summary: { marginBlockStart: 8, marginInlineStart: 32, minWidth: 0 },
  toggle: {
    color: cssVar.colorTextSecondary,
    height: 'auto',
    maxWidth: '100%',
    paddingBlock: 4,
    paddingInline: 0,
  },
  summaryContent: { alignItems: 'center', flexWrap: 'wrap', minWidth: 0 },
  participants: { display: 'flex', flexShrink: 0, paddingInlineStart: 6 },
  participant: {
    backgroundColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    boxShadow: `0 0 0 2px ${cssVar.colorBgContainer}`,
    display: 'flex',
    marginInlineStart: -6,
  },
  thread: {
    borderInlineStartColor: cssVar.colorBorder,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 1,
    marginBlockStart: 16,
    marginInlineStart: 32,
    paddingBlockEnd: 4,
    paddingInlineStart: { 'default': 20, '@media (max-width: 600px)': 12 },
  },
});

interface CommentCardProps {
  activity: TaskDetailActivity;
  readOnly?: boolean;
  replies?: TaskDetailActivity[];
  taskId?: string;
}

/** The only timeline item in a thread; replies never acquire a timeline rail. */
const CommentCard = ({ activity, readOnly, replies = [], taskId }: CommentCardProps) => {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [replyRequest, setReplyRequest] = useState<CommentReplyRequest>();
  const threadId = useId();
  const latest = replies.at(-1);
  const { text: latestTime, title: latestTitle } = useActivityTime(latest?.time);
  const participants = [
    ...new Map(
      replies.flatMap(({ author }) =>
        author ? [[`${author.type}-${author.id}`, author] as const] : [],
      ),
    ).values(),
  ].slice(0, 3);

  const handleReply = (comment: TaskDetailActivity) => {
    setHasOpened(true);
    setIsExpanded(true);
    setReplyRequest((previous) => ({
      author: comment.id === activity.id ? undefined : comment.author,
      nonce: (previous?.nonce ?? 0) + 1,
    }));
  };

  return (
    <div className={timelineStyles.commentLine}>
      <CommentItem
        activity={activity}
        hasReplies={replies.length > 0}
        readOnly={readOnly}
        taskId={taskId}
        onReply={!readOnly && taskId ? handleReply : undefined}
      />
      {replies.length > 0 && (
        <div {...stylex.props(styles.summary)}>
          <Button
            aria-controls={threadId}
            aria-expanded={isExpanded}
            size={'small'}
            type={'text'}
            {...stylex.props(styles.toggle)}
            onClick={() => {
              setHasOpened(true);
              setIsExpanded((previous) => !previous);
            }}
          >
            <Flexbox horizontal gap={8} {...stylex.props(styles.summaryContent)}>
              <span aria-hidden {...stylex.props(styles.participants)}>
                {participants.map((author) => (
                  <span key={`${author.type}-${author.id}`} {...stylex.props(styles.participant)}>
                    <Avatar avatar={author.avatar || author.name || ''} size={20} />
                  </span>
                ))}
              </span>
              <Text fontSize={12} weight={500}>
                {t('taskDetail.comment.thread.replies', { count: replies.length })}
              </Text>
              {latestTime && (
                <Text fontSize={12} title={latestTitle} type={'secondary'}>
                  {t('taskDetail.comment.thread.latest', { time: latestTime })}
                </Text>
              )}
              <Icon icon={isExpanded ? ChevronUp : ChevronDown} size={14} />
            </Flexbox>
          </Button>
        </div>
      )}
      {hasOpened && (
        <section
          aria-label={t('taskDetail.comment.thread.label', { name: activity.author?.name ?? '' })}
          hidden={!isExpanded}
          id={threadId}
          {...stylex.props(styles.thread)}
        >
          <Flexbox gap={20}>
            {replies.map((reply, index) => (
              <CommentItem
                activity={reply}
                key={reply.id ?? index}
                readOnly={readOnly}
                taskId={taskId}
                onReply={!readOnly && taskId ? handleReply : undefined}
              />
            ))}
            {!readOnly && taskId && activity.id && (
              <CommentInput
                parentCommentId={activity.id}
                replyRequest={replyRequest}
                taskId={taskId}
              />
            )}
          </Flexbox>
        </section>
      )}
    </div>
  );
};

export default CommentCard;
