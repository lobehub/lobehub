import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import MemoryAnalysis from '@/app/[variants]/(main)/memory/features/MemoryAnalysis';
import { useQueryState } from '@/hooks/useQueryParam';
import { useGlobalStore } from '@/store/global';
import { useUserMemoryStore } from '@/store/userMemory';

import MemoryEmpty from '../../../features/MemoryEmpty';
import { type ViewMode } from '../../../features/ViewModeSwitcher';
import GridView from './GridView';
import TimelineView from './TimelineView';

export type IdentityType = 'all' | 'demographic' | 'personal' | 'professional';

interface IdentitiesListProps {
  isLoading?: boolean;
  searchValue?: string;
  viewMode: ViewMode;
}

const IdentitiesList = memo<IdentitiesListProps>(({ isLoading, searchValue, viewMode }) => {
  const { t } = useTranslation(['memory', 'common']);
  const [, setIdentityId] = useQueryState('identityId', { clearOnDefault: true });
  const toggleRightPanel = useGlobalStore((s) => s.toggleRightPanel);
  const identities = useUserMemoryStore((s) => s.identities);

  const handleCardClick = (identity: any) => {
    setIdentityId(identity.id);
    toggleRightPanel(true);
  };

  if (!identities || identities.length === 0)
    return (
      <MemoryEmpty search={Boolean(searchValue)} title={t('identity.empty')}>
        <MemoryAnalysis />
      </MemoryEmpty>
    );

  if (viewMode === 'timeline')
    return <TimelineView identities={identities} isLoading={isLoading} onClick={handleCardClick} />;

  return <GridView identities={identities} isLoading={isLoading} onClick={handleCardClick} />;
});

export default IdentitiesList;
