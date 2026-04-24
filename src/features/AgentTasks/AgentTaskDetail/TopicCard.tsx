import type { TaskDetailActivity } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Block,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CalendarDays, Copy, ExternalLink, MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';

import TopicStatusIcon from './TopicStatusIcon';

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
  const { t } = useTranslation('chat');
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

  const handleOpen = useCallback(() => {
    if (activity.id) openTopicDrawer(activity.id);
  }, [activity.id, openTopicDrawer]);

  const handleCopyId = useCallback(() => {
    if (activity.id) void navigator.clipboard.writeText(activity.id);
  }, [activity.id]);

  const startedAt = activity.time ? dayjs(activity.time).fromNow() : '';
  const durationText = isRunning ? formatDuration(elapsed) : '';

  const menuItems: DropdownItem[] = [
    {
      icon: ExternalLink,
      key: 'open',
      label: t('taskDetail.topicMenu.open', { defaultValue: 'Open run' }),
      onClick: handleOpen,
    },
    {
      disabled: !activity.id,
      icon: Copy,
      key: 'copy',
      label: t('taskDetail.topicMenu.copyId', { defaultValue: 'Copy run ID' }),
      onClick: handleCopyId,
    },
  ];

  return (
    <Block
      clickable={!!activity.id}
      gap={8}
      padding={12}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
      onClick={activity.id ? handleOpen : undefined}
    >
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, overflow: 'hidden' }}>
          <TopicStatusIcon size={16} status={activity.status} />
          <Text ellipsis weight={500}>
            {activity.title}
          </Text>
          {activity.seq != null && (
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              #{activity.seq}
            </Text>
          )}
          {durationText && (
            <Text fontSize={12} style={{ flexShrink: 0 }} type={'secondary'}>
              · {durationText}
            </Text>
          )}
        </Flexbox>

        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          {activity.author && (
            <Flexbox horizontal align={'center'} gap={6}>
              {activity.author.avatar && <Avatar avatar={activity.author.avatar} size={20} />}
              <Text fontSize={12} type={'secondary'}>
                {activity.author.name}
              </Text>
            </Flexbox>
          )}
          {startedAt && (
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon color={cssVar.colorTextTertiary} icon={CalendarDays} size={12} />
              <Text fontSize={12} type={'secondary'}>
                {startedAt}
              </Text>
            </Flexbox>
          )}
          <DropdownMenu items={menuItems}>
            <ActionIcon
              icon={MoreHorizontal}
              size={'small'}
              onClick={(e) => {
                e.stopPropagation();
              }}
            />
          </DropdownMenu>
        </Flexbox>
      </Flexbox>

      {activity.summary && (
        <Text fontSize={13} style={{ color: cssVar.colorTextSecondary, whiteSpace: 'pre-wrap' }}>
          {activity.summary}
        </Text>
      )}
    </Block>
  );
});

export default TopicCard;
