import { type ActivityListItem } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TimeLineCard from '@/app/[variants]/(main)/memory/features/TimeLineView/TimeLineCard';

import ActivityDropdown from '../../ActivityDropdown';

interface ActivityCardProps {
  activity: ActivityListItem;
  onClick: (activity: ActivityListItem) => void;
}

const ActivityCard = memo<ActivityCardProps>(({ activity, onClick }) => {
  const { t } = useTranslation('memory');
  const capturedAt =
    activity.startsAt || activity.capturedAt || activity.updatedAt || activity.createdAt;

  return (
    <TimeLineCard
      actions={<ActivityDropdown id={activity.id} />}
      capturedAt={capturedAt}
      cate={activity.type}
      hashTags={activity.tags}
      title={activity.title || t('activity.defaultType')}
      titleAddon={activity.status}
      onClick={() => onClick(activity)}
    >
      {activity.narrative || activity.notes || activity.status || t('activity.defaultType')}
    </TimeLineCard>
  );
});

export default ActivityCard;
