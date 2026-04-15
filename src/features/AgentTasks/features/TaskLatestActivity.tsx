import type { TaskDetailActivity } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { TreeDownRightIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

const getActivityText = (activity?: TaskDetailActivity) => {
  if (!activity) return undefined;

  if (activity.type === 'comment') return activity.content || undefined;
  if (activity.type === 'topic') {
    const title = activity.title || 'Untitled topic';
    return activity.seq ? `Topic #${activity.seq}: ${title}` : `Topic: ${title}`;
  }

  const briefTitle = activity.title || activity.summary;
  if (!briefTitle) return activity.briefType ? `Brief (${activity.briefType})` : 'Brief';

  if (activity.resolvedAction) return `${briefTitle} · ${activity.resolvedAction}`;
  return activity.briefType
    ? `Brief (${activity.briefType}): ${briefTitle}`
    : `Brief: ${briefTitle}`;
};

interface TaskLatestActivityProps {
  activities?: TaskDetailActivity[];
}

const TaskLatestActivity = memo<TaskLatestActivityProps>(({ activities }) => {
  const latestActivityText = useMemo(() => {
    if (!activities || activities.length === 0) return undefined;

    const latest = [...activities].sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      return timeB - timeA;
    })[0];

    return getActivityText(latest);
  }, [activities]);

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
