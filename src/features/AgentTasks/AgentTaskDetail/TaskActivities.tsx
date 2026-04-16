import type { TaskActivityType, TaskDetailActivity } from '@lobechat/types';
import { Accordion, AccordionItem, Avatar, Empty, Flexbox, Icon, Text } from '@lobehub/ui';
import { Divider, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import { BotMessageSquare, ChevronDown, MessageCircle, MessagesSquare, Zap } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useTaskStore } from '@/store/task';
import { taskActivitySelectors } from '@/store/task/selectors';

import { styles } from '../shared/style';

const typeIconMap: Record<TaskActivityType, LucideIcon> = {
  brief: Zap,
  comment: MessageCircle,
  topic: MessagesSquare,
};

const getActivityDisplayText = (act: TaskDetailActivity, t: TFunction<'chat'>): string => {
  if (act.type === 'comment') {
    return act.content || t('taskDetail.activities.fallback.comment');
  }
  if (act.type === 'topic') {
    return act.title || t('taskDetail.activities.fallback.topic');
  }
  if (act.type === 'brief') {
    return act.title || act.summary || t('taskDetail.activities.fallback.brief');
  }
  return '';
};

const TaskActivities = memo(() => {
  const { t } = useTranslation('chat');
  const activities = useTaskStore(taskActivitySelectors.activeTaskActivities);

  const activityTreeData = useMemo((): DataNode[] => {
    return activities.map((act, index) => {
      const TypeIcon = typeIconMap[act.type] ?? MessageCircle;
      const relTime = act.time ? dayjs(act.time).fromNow() : '';
      const displayText = getActivityDisplayText(act, t);
      const key = act.id ?? `activity-${index}`;

      return {
        icon: act.author?.avatar ? (
          <Avatar avatar={act.author.avatar} size={24} />
        ) : (
          <div className={styles.activityAvatar}>
            <TypeIcon size={12} />
          </div>
        ),
        key,
        title: (
          <Text ellipsis style={{ color: cssVar.colorTextSecondary }}>
            {act.author?.name && <span style={{ fontWeight: 500 }}>{act.author.name} </span>}
            {displayText}
            {relTime && (
              <span style={{ color: cssVar.colorTextQuaternary, marginInlineStart: 4 }}>
                · {relTime}
              </span>
            )}
          </Text>
        ),
      };
    });
  }, [activities, t]);

  return (
    <>
      <Divider dashed />
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
          {activityTreeData.length > 0 ? (
            <Tree
              blockNode
              defaultExpandAll
              showIcon
              showLine
              className={styles.subtaskTree}
              selectable={false}
              style={{ marginTop: 8 }}
              switcherIcon={<Icon icon={ChevronDown} size={14} />}
              treeData={activityTreeData}
            />
          ) : (
            <Empty
              description={t('taskDetail.activitiesEmpty')}
              icon={BotMessageSquare}
              style={{ marginTop: 8 }}
            />
          )}
        </AccordionItem>
      </Accordion>
    </>
  );
});

export default TaskActivities;
