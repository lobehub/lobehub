import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryEmpty from '@/app/[variants]/(main)/memory/features/MemoryEmpty';
import { useQueryState } from '@/hooks/useQueryParam';
import { useGlobalStore } from '@/store/global';
import { useUserMemoryStore } from '@/store/userMemory';

import { type ViewMode } from '../../../features/ViewModeSwitcher';
import GridView from './GridView';
import TimelineView from './TimelineView';

interface ActivitiesListProps {
  isLoading?: boolean;
  searchValue?: string;
  viewMode: ViewMode;
}

const ActivitiesList = memo<ActivitiesListProps>(({ isLoading, searchValue, viewMode }) => {
  const { t } = useTranslation(['memory', 'common']);
  const [, setActivityId] = useQueryState('activityId', { clearOnDefault: true });
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const activities = useUserMemoryStore((s) => s.activities);

  const handleCardClick = (activity: any) => {
    setActivityId(activity.id);
    toggleRightPanel(true);
  };

  const isEmpty = activities.length === 0;

  if (isEmpty) {
    return <MemoryEmpty search={Boolean(searchValue)} title={t('activity.empty')} />;
  }

  return viewMode === 'timeline' ? (
    <TimelineView activities={activities} isLoading={isLoading} onCardClick={handleCardClick} />
  ) : (
    <GridView activities={activities} isLoading={isLoading} onClick={handleCardClick} />
  );
});

export default ActivitiesList;
