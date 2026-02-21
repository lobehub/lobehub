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

interface PreferencesListProps {
  isLoading?: boolean;
  searchValue?: string;
  viewMode: ViewMode;
}

const PreferencesList = memo<PreferencesListProps>(({ isLoading, searchValue, viewMode }) => {
  const { t } = useTranslation(['memory', 'common']);
  const [, setPreferenceId] = useQueryState('preferenceId', { clearOnDefault: true });
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const preferences = useUserMemoryStore((s) => s.preferences);

  const handleCardClick = (preference: any) => {
    setPreferenceId(preference.id);
    toggleRightPanel(true);
  };

  const isEmpty = preferences.length === 0;

  if (isEmpty) {
    return (
      <MemoryEmpty search={Boolean(searchValue)} title={t('preference.empty')}>
        <MemoryAnalysis />
      </MemoryEmpty>
    );
  }

  return viewMode === 'timeline' ? (
    <TimelineView isLoading={isLoading} preferences={preferences} onClick={handleCardClick} />
  ) : (
    <GridView isLoading={isLoading} preferences={preferences} onClick={handleCardClick} />
  );
});

export default PreferencesList;
