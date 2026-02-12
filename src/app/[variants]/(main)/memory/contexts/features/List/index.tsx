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

interface ContextsListProps {
  isLoading?: boolean;
  searchValue?: string;
  viewMode: ViewMode;
}

const ContextsList = memo<ContextsListProps>(({ isLoading, searchValue, viewMode }) => {
  const { t } = useTranslation(['memory', 'common']);
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const [, setContextId] = useQueryState('contextId', { clearOnDefault: true });

  const contexts = useUserMemoryStore((s) => s.contexts);

  const handleCardClick = (context: any) => {
    setContextId(context.id);
    toggleRightPanel(true);
  };

  const isEmpty = contexts.length === 0;

  if (isEmpty) {
    return (
      <MemoryEmpty search={Boolean(searchValue)} title={t('context.empty')}>
        <MemoryAnalysis />
      </MemoryEmpty>
    );
  }

  return viewMode === 'timeline' ? (
    <TimelineView contexts={contexts} isLoading={isLoading} onClick={handleCardClick} />
  ) : (
    <GridView contexts={contexts} isLoading={isLoading} onClick={handleCardClick} />
  );
});

export default ContextsList;
