import type { TaskDetailActivity } from '@lobechat/types';
import {
  ActionIcon,
  Avatar,
  Block,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  stopPropagation,
  Text,
} from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { CircleDot, CircleStop, Copy, ExternalLink, MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { useActivityTime } from '@/hooks/useActivityTime';
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
  const cancelTopic = useTaskStore((s) => s.cancelTopic);
  const isRunning = activity.status === 'running';

  const finalDuration =
    !isRunning && activity.time && activity.completedAt
      ? new Date(activity.completedAt).getTime() - new Date(activity.time).getTime()
      : null;

  const [elapsed, setElapsed] = useState(() =>
    isRunning && activity.time ? Date.now() - new Date(activity.time).getTime() : 0,
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

  const handleCopyOperationId = useCallback(() => {
    if (activity.operationId) void navigator.clipboard.writeText(activity.operationId);
  }, [activity.operationId]);

  const handleStop = useCallback(() => {
    if (!activity.id) return;
    const topicId = activity.id;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('taskDetail.topicMenu.stopConfirm.content', {
        defaultValue:
          'The current run will be canceled. Generated messages are kept and you can re-run the task later.',
      }),
      okText: t('taskDetail.topicMenu.stop', { defaultValue: 'Stop run' }),
      onOk: async () => {
        await cancelTopic(topicId);
      },
      title: t('taskDetail.topicMenu.stopConfirm.title', { defaultValue: 'Stop run?' }),
    });
  }, [activity.id, cancelTopic, t]);

  const { text: startedAt, title: startedAtTitle } = useActivityTime(activity.time);
  const durationText = isRunning
    ? formatDuration(elapsed)
    : finalDuration != null && finalDuration >= 0
      ? formatDuration(finalDuration)
      : '';

  const menuItems: DropdownItem[] = [
    ...(isRunning && activity.id
      ? [
          {
            danger: true,
            icon: CircleStop,
            key: 'stop',
            label: t('taskDetail.topicMenu.stop', { defaultValue: 'Stop run' }),
            onClick: handleStop,
          },
          { type: 'divider' as const },
        ]
      : []),
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
      label: t('taskDetail.topicMenu.copyId', { defaultValue: 'Copy topic ID' }),
      onClick: handleCopyId,
    },
    {
      disabled: !activity.operationId,
      icon: Copy,
      key: 'copyOperationId',
      label: t('taskDetail.topicMenu.copyOperationId', { defaultValue: 'Copy operation ID' }),
      onClick: handleCopyOperationId,
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
            <Text fontSize={12} title={startedAtTitle} type={'secondary'}>
              {startedAt}
            </Text>
          )}
          <Flexbox onClick={stopPropagation}>
            <DropdownMenu items={menuItems}>
              <ActionIcon icon={MoreHorizontal} size={'small'} />
            </DropdownMenu>
          </Flexbox>
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
