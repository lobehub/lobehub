import type { TaskDetailActivity } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { TreeDownRightIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import type { TFunction } from 'i18next';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const getActivityText = (activity: TaskDetailActivity | undefined, t: TFunction<'chat'>) => {
  if (!activity) return undefined;

  if (activity.type === 'comment') return activity.content || undefined;
  if (activity.type === 'topic') {
    const title = activity.title || t('taskDetail.latestActivity.untitledTopic');
    return activity.seq
      ? t('taskDetail.latestActivity.topicWithSeq', { seq: activity.seq, title })
      : t('taskDetail.latestActivity.topic', { title });
  }

  const briefTitle = activity.title || activity.summary;
  if (!briefTitle) {
    return activity.briefType
      ? t('taskDetail.latestActivity.briefWithTypeOnly', { type: activity.briefType })
      : t('taskDetail.latestActivity.briefOnly');
  }

  if (activity.resolvedAction) {
    return t('taskDetail.latestActivity.briefWithAction', {
      action: activity.resolvedAction,
      title: briefTitle,
    });
  }
  return activity.briefType
    ? t('taskDetail.latestActivity.briefWithType', { type: activity.briefType, title: briefTitle })
    : t('taskDetail.latestActivity.brief', { title: briefTitle });
};

interface TaskLatestActivityProps {
  activities?: TaskDetailActivity[];
}

const TaskLatestActivity = memo<TaskLatestActivityProps>(({ activities }) => {
  const { t } = useTranslation('chat');
  const latestActivityText = useMemo(() => {
    if (!activities || activities.length === 0) return undefined;

    const latest = [...activities].sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      return timeB - timeA;
    })[0];

    return getActivityText(latest, t);
  }, [activities, t]);

  if (!latestActivityText) return null;

  return (
    <Flexbox horizontal align={'flex-start'} gap={4}>
      <Icon
        color={cssVar.colorTextQuaternary}
        icon={TreeDownRightIcon}
        style={{
          marginTop: 2,
          marginLeft: 6,
        }}
      />
      <Text ellipsis fontSize={12} style={{ color: cssVar.colorTextDescription }}>
        {latestActivityText}
      </Text>
    </Flexbox>
  );
});

export default TaskLatestActivity;
