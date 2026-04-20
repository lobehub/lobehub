import type { TaskDetailActivity } from '@lobechat/types';
import { Avatar, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { MessagesSquare } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { useTaskStore } from '@/store/task';

const TOPIC_STATUS_COLOR: Record<string, string> = {
  canceled: cssVar.colorTextSecondary,
  completed: cssVar.colorSuccess,
  failed: cssVar.colorError,
  running: cssVar.colorInfo,
  timeout: cssVar.colorWarning,
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

interface TopicCardProps {
  activity: TaskDetailActivity;
}

const TopicCard = memo<TopicCardProps>(({ activity }) => {
  const openTopicDrawer = useTaskStore((s) => s.openTopicDrawer);
  const isRunning = activity.status === 'running';

  const [elapsed, setElapsed] = useState(() =>
    activity.time ? Date.now() - new Date(activity.time).getTime() : 0,
  );

  useEffect(() => {
    if (!isRunning || !activity.time) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - new Date(activity.time!).getTime());
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, activity.time]);

  const handleClick = useCallback(() => {
    if (activity.id) openTopicDrawer(activity.id);
  }, [activity.id, openTopicDrawer]);

  const statusColor = TOPIC_STATUS_COLOR[activity.status ?? ''] ?? cssVar.colorTextQuaternary;
  const timeDisplay = isRunning
    ? formatDuration(elapsed)
    : activity.time
      ? dayjs(activity.time).fromNow()
      : '';

  return (
    <Block
      clickable={!!activity.id}
      gap={8}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
      onClick={activity.id ? handleClick : undefined}
    >
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
          <Icon color={cssVar.colorTextDescription} icon={MessagesSquare} size={16} />
          <Text ellipsis weight={500}>
            {activity.title}
          </Text>
          {activity.seq != null && (
            <Text fontSize={12} type={'secondary'}>
              #{activity.seq}
            </Text>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          <Tag size={'small'} style={{ color: statusColor }}>
            {activity.status ?? 'unknown'}
          </Tag>
          <Text fontSize={12} type={'secondary'}>
            {timeDisplay}
          </Text>
        </Flexbox>
      </Flexbox>

      {activity.summary && (
        <Text fontSize={13} style={{ color: cssVar.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
          {activity.summary}
        </Text>
      )}

      {activity.author && (
        <Flexbox horizontal align={'center'} gap={6}>
          {activity.author.avatar && <Avatar avatar={activity.author.avatar} size={20} />}
          <Text fontSize={12} type={'secondary'}>
            {activity.author.name}
          </Text>
        </Flexbox>
      )}
    </Block>
  );
});

export default TopicCard;
