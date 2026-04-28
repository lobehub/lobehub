import type { TaskDetailActivity } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Block,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { CircleDot, Copy, ExternalLink, MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { useTaskStore } from '@/store/task';

import { styles } from '../shared/style';
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

  const isAgent = activity.author?.type === 'agent';

  const avatarNode = activity.author?.avatar ? (
    <Avatar avatar={activity.author.avatar} size={24} />
  ) : (
    <div className={styles.activityAvatar}>
      <CircleDot size={12} />
    </div>
  );

  return (
    <Block
      clickable={!!activity.id}
      gap={8}
      paddingBlock={8}
      paddingInline={8}
      style={{ borderRadius: cssVar.borderRadiusLG }}
      variant={'outlined'}
      onClick={activity.id ? handleOpen : undefined}
    >
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0, overflow: 'hidden' }}>
          {isAgent && activity.author?.id ? (
            <AgentProfilePopup
              agent={{ avatar: activity.author.avatar, title: activity.author.name }}
              agentId={activity.author.id}
              trigger={'hover'}
            >
              {avatarNode}
            </AgentProfilePopup>
          ) : (
            avatarNode
          )}
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
          {startedAt && (
            <Text fontSize={12} type={'secondary'}>
              {startedAt}
            </Text>
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
