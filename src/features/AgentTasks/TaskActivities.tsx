import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { Input } from 'antd';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ArrowUp, MessageCircle, MessagesSquare, Zap } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskActivitySelectors, taskDetailSelectors } from '@/store/task/selectors';

import { styles } from './style';

const typeIconMap = {
  brief: Zap,
  comment: MessageCircle,
  topic: MessagesSquare,
};

const ActivityItem = memo<{
  agentId?: string | null;
  content?: string;
  summary?: string;
  time?: string;
  title?: string;
  type: string;
}>(({ type, title, content, summary, time, agentId }) => {
  const agent = useAgentStore((s) => agentByIdSelectors.getAgentById(agentId ?? '')(s));
  const LucideIcon = typeIconMap[type as keyof typeof typeIconMap] ?? MessageCircle;
  const relTime = time ? dayjs(time).fromNow() : '';

  let displayText = '';
  if (type === 'comment') {
    displayText = content || 'left a comment';
  } else if (type === 'topic') {
    displayText = title || 'started a topic';
  } else if (type === 'brief') {
    displayText = title || summary || 'posted a brief';
  }

  const agentName = agent?.title;

  return (
    <div className={styles.activityItem}>
      {agent?.avatar ? (
        <Avatar avatar={agent.avatar} size={24} />
      ) : (
        <div className={styles.activityAvatar}>
          <LucideIcon size={12} />
        </div>
      )}
      <Text ellipsis style={{ color: cssVar.colorTextSecondary }}>
        {agentName && <span style={{ fontWeight: 500 }}>{agentName} </span>}
        {displayText}
        {relTime && (
          <span style={{ color: cssVar.colorTextQuaternary, marginInlineStart: 4 }}>
            · {relTime}
          </span>
        )}
      </Text>
    </div>
  );
});

const CommentInput = memo<{ taskId: string }>(({ taskId }) => {
  const { t } = useTranslation('chat');
  const addComment = useTaskStore((s) => s.addComment);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasComment = comment.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    const trimmed = comment.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment(taskId, trimmed);
      setComment('');
    } finally {
      setSubmitting(false);
    }
  }, [taskId, comment, addComment, submitting]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className={styles.commentBox}>
      <Input.TextArea
        autoSize={{ maxRows: 8, minRows: 3 }}
        className={styles.commentInput}
        placeholder={t('taskDetail.commentPlaceholder')}
        value={comment}
        variant="borderless"
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Flexbox horizontal className={styles.commentActions} gap={4}>
        <ActionIcon
          disabled={!hasComment || submitting}
          icon={ArrowUp}
          loading={submitting}
          size="small"
          onClick={handleSubmit}
        />
      </Flexbox>
    </div>
  );
});

const TaskActivities = memo(() => {
  const { t } = useTranslation('chat');
  const activities = useTaskStore(taskActivitySelectors.activeTaskActivities);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);

  return (
    <Flexbox gap={0}>
      <Flexbox horizontal align="center" className={styles.activityDivider}>
        <Text style={{ fontSize: cssVar.fontSize }} weight="bold">
          {t('taskDetail.activities')}
        </Text>
      </Flexbox>

      {activities.map((act, index) => (
        <ActivityItem
          agentId={act.agentId}
          content={act.content}
          key={act.id ?? index}
          summary={act.summary}
          time={act.time}
          title={act.title}
          type={act.type}
        />
      ))}

      {taskId && <CommentInput taskId={taskId} />}
    </Flexbox>
  );
});

export default TaskActivities;
