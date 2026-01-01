import { memo } from 'react';

import { type DisplayExperienceMemory } from '@/database/repositories/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import ExperienceCard from './ExperienceCard';

interface GridViewProps {
  experiences: DisplayExperienceMemory[];
  isLoading?: boolean;
  onClick: (experience: DisplayExperienceMemory) => void;
}

const ExperiencesGridView = memo<GridViewProps>(({ experiences, isLoading, onClick }) => {
  const loadMoreExperiences = useUserMemoryStore((s) => s.loadMoreExperiences);
  const experiencesHasMore = useUserMemoryStore((s) => s.experiencesHasMore);

  return (
    <GridView
      hasMore={experiencesHasMore}
      isLoading={isLoading}
      items={experiences}
      onLoadMore={loadMoreExperiences}
      renderItem={(experience) => (
        <ExperienceCard experience={experience} onClick={() => onClick(experience)} />
      )}
    />
  );
});

export default ExperiencesGridView;
