import { type ActivityListItem } from '@lobechat/types';
import { Tag } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';

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
    <GridCard
      actions={<ActivityDropdown id={activity.id} />}
      badges={activity.status ? <Tag>{activity.status}</Tag> : undefined}
      capturedAt={capturedAt}
      cate={activity.type}
      hashTags={activity.tags}
      title={activity.title || t('activity.defaultType')}
      titleAddon={activity.timezone}
      onClick={() => onClick(activity)}
    >
      {activity.narrative || activity.notes || t('activity.defaultType')}
    </GridCard>
  );
});

export default ActivityCard;
