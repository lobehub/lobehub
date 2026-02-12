import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryAnalysis from '@/app/[variants]/(main)/memory/features/MemoryAnalysis';
import MemoryEmpty from '@/app/[variants]/(main)/memory/features/MemoryEmpty';
import { useQueryState } from '@/hooks/useQueryParam';
import { useGlobalStore } from '@/store/global';
import { useUserMemoryStore } from '@/store/userMemory';

import { type ViewMode } from '../../../features/ViewModeSwitcher';
import GridView from './GridView';
import TimelineView from './TimelineView';

interface ExperiencesListProps {
  isLoading?: boolean;
  searchValue?: string;
  viewMode: ViewMode;
}

const ExperiencesList = memo<ExperiencesListProps>(({ isLoading, searchValue, viewMode }) => {
  const { t } = useTranslation(['memory', 'common']);
  const [, setExperienceId] = useQueryState('experienceId', { clearOnDefault: true });
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const experiences = useUserMemoryStore((s) => s.experiences);

  const handleCardClick = (experience: any) => {
    setExperienceId(experience.id);
    toggleRightPanel(true);
  };

  const isEmpty = experiences.length === 0;

  if (isEmpty) {
    return (
      <MemoryEmpty search={Boolean(searchValue)} title={t('experience.empty')}>
        <MemoryAnalysis />
      </MemoryEmpty>
    );
  }

  return viewMode === 'timeline' ? (
    <TimelineView experiences={experiences} isLoading={isLoading} onCardClick={handleCardClick} />
  ) : (
    <GridView experiences={experiences} isLoading={isLoading} onClick={handleCardClick} />
  );
});

export default ExperiencesList;
