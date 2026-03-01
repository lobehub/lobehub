import { memo } from 'react';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import PreferenceCard from './PreferenceCard';

interface GridViewProps {
  isLoading?: boolean;
  onClick: (preference: DisplayPreferenceMemory) => void;
  preferences: DisplayPreferenceMemory[];
}

const PreferenceGridView = memo<GridViewProps>(({ preferences, isLoading, onClick }) => {
  const loadMorePreferences = useUserMemoryStore((s) => s.loadMorePreferences);
  const preferencesHasMore = useUserMemoryStore((s) => s.preferencesHasMore);

  return (
    <GridView
      hasMore={preferencesHasMore}
      isLoading={isLoading}
      items={preferences}
      renderItem={(preference) => (
        <PreferenceCard preference={preference} onClick={() => onClick(preference)} />
      )}
      onLoadMore={loadMorePreferences}
    />
  );
});

export default PreferenceGridView;
