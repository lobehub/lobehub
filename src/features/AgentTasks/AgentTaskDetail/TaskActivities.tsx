import type { BriefType, TaskDetailActivity } from '@lobechat/types';
import { Accordion, AccordionItem, Avatar, Empty, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import { BotMessageSquare, CircleDot, CirclePlus, MessageCircle } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import BriefCard from '@/features/DailyBrief/BriefCard';
import type { BriefItem } from '@/features/DailyBrief/types';
import { useTaskStore } from '@/store/task';
import { taskActivitySelectors, taskDetailSelectors } from '@/store/task/selectors';

import { styles } from '../shared/style';
import CommentCard from './CommentCard';
import CommentInput from './CommentInput';
import TopicCard from './TopicCard';

const ROW_TYPE_ICON = {
  comment: MessageCircle,
  created: CirclePlus,
  topic: CircleDot,
} as const;

/** Convert a brief-type activity to the BriefItem shape expected by BriefCard. */
const toBriefItem = (act: TaskDetailActivity): BriefItem | null => {
  if (!act.id || !act.briefType) return null;
  return {
    actions: (act.actions ?? null) as BriefItem['actions'],
    agentId: act.agentId ?? null,
    agents: (act.agents ?? []).map((a) => ({
      avatar: a.avatar,
      backgroundColor: a.backgroundColor,
      id: a.id,
      title: a.title,
    })),
    artifacts: act.artifacts,
    createdAt: act.createdAt ?? act.time ?? new Date().toISOString(),
    cronJobId: act.cronJobId ?? null,
    id: act.id,
    priority: act.priority ?? null,
    readAt: act.readAt ?? null,
    resolvedAction: act.resolvedAction ?? null,
    resolvedAt: act.resolvedAt ?? null,
    resolvedComment: act.resolvedComment ?? null,
    summary: act.summary ?? '',
    taskId: act.taskId ?? null,
    title: act.title ?? '',
    topicId: act.topicId ?? null,
    type: act.briefType as BriefType,
    userId: act.userId ?? '',
  };
};

const getRowText = (act: TaskDetailActivity, t: TFunction<'chat'>): string => {
  if (act.type === 'comment') return act.content || t('taskDetail.activities.fallback.comment');
  if (act.type === 'topic') return act.title || t('taskDetail.activities.fallback.topic');
  if (act.type === 'created') return t('taskDetail.activities.fallback.created');
  return '';
};

/** Compact one-line row for topic / comment activities. */
const ActivityRow = memo<{ activity: TaskDetailActivity }>(({ activity }) => {
  const { t } = useTranslation('chat');
  const TypeIcon = ROW_TYPE_ICON[activity.type as keyof typeof ROW_TYPE_ICON] ?? MessageCircle;
  const relTime = activity.time ? dayjs(activity.time).fromNow() : '';
  const text = getRowText(activity, t);

  const isAgent = activity.author?.type === 'agent';
  const avatarNode = activity.author?.avatar ? (
    <Avatar avatar={activity.author.avatar} size={24} />
  ) : (
    <div className={styles.activityAvatar}>
      <TypeIcon size={12} />
    </div>
  );

  const authorNode = (
    <Flexbox horizontal align={'center'} gap={6} style={{ flexShrink: 0 }}>
      {avatarNode}
      {activity.author?.name && (
        <Text
          className={isAgent ? styles.agentAuthorName : undefined}
          style={isAgent ? undefined : { color: cssVar.colorTextSecondary, fontWeight: 500 }}
        >
          {activity.author.name}
        </Text>
      )}
      {isAgent && (
        <Tag size={'small'} style={{ flexShrink: 0 }}>
          {t('taskDetail.activities.agentTag')}
        </Tag>
      )}
    </Flexbox>
  );

  return (
    <Flexbox horizontal align={'center'} gap={8} paddingBlock={4} paddingInline={9}>
      {isAgent && activity.author?.id ? (
        <AgentProfilePopup
          agent={{ avatar: activity.author.avatar, title: activity.author.name }}
          agentId={activity.author.id}
          trigger={'hover'}
        >
          {authorNode}
        </AgentProfilePopup>
      ) : (
        authorNode
      )}
      <Text ellipsis style={{ color: cssVar.colorTextSecondary, flex: 1, minWidth: 0 }}>
        {text}
        {relTime && (
          <span style={{ color: cssVar.colorTextQuaternary, marginInlineStart: 4 }}>
            · {relTime}
          </span>
        )}
      </Text>
    </Flexbox>
  );
});

const TaskActivities = memo(() => {
  const { t } = useTranslation('chat');
  const activities = useTaskStore(taskActivitySelectors.activeTaskActivities);
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const refreshTaskDetail = useTaskStore((s) => s.internal_refreshTaskDetail);

  const refreshActiveTask = useCallback(async () => {
    if (activeTaskId) await refreshTaskDetail(activeTaskId);
  }, [activeTaskId, refreshTaskDetail]);

  const items = useMemo(
    () =>
      activities
        .map((act, i) => ({
          activity: act,
          brief: act.type === 'brief' ? toBriefItem(act) : null,
          key: act.id ?? `activity-${i}`,
        }))
        .reverse(),
    [activities],
  );

  return (
    <Accordion defaultExpandedKeys={['activities']} gap={0}>
      <AccordionItem
        itemKey="activities"
        paddingBlock={4}
        paddingInline={8}
        title={
          <Flexbox horizontal align="center" gap={8}>
            <Icon color={cssVar.colorTextDescription} icon={BotMessageSquare} size={16} />
            <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
              {t('taskDetail.activities')}
            </Text>
          </Flexbox>
        }
      >
        <Flexbox gap={12} paddingBlock={12} paddingInline={12}>
          {activeTaskId && <CommentInput taskId={activeTaskId} />}
          {items.length > 0 ? (
            items.map(({ activity, brief, key }) => {
              if (brief) {
                return (
                  <BriefCard
                    brief={brief}
                    enableNavigation={false}
                    key={key}
                    onAfterAddComment={refreshActiveTask}
                    onAfterResolve={refreshActiveTask}
                  />
                );
              }
              if (activity.type === 'topic') {
                return <TopicCard activity={activity} key={key} />;
              }
              if (activity.type === 'comment') {
                return <CommentCard activity={activity} key={key} />;
              }
              return <ActivityRow activity={activity} key={key} />;
            })
          ) : (
            <Empty
              description={t('taskDetail.activitiesEmpty')}
              icon={BotMessageSquare}
              style={{ marginTop: 8 }}
            />
          )}
        </Flexbox>
      </AccordionItem>
    </Accordion>
  );
});

export default TaskActivities;
