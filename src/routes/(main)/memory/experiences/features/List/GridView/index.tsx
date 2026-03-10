import { type ExperienceListItem } from '@lobechat/types';
import { memo } from 'react';

import { useUserMemoryStore } from '@/store/userMemory';

import { GridView } from '../../../../features/GridView';
import ExperienceCard from './ExperienceCard';

interface GridViewProps {
  experiences: ExperienceListItem[];
  isLoading?: boolean;
  onClick: (experience: ExperienceListItem) => void;
}

const ExperiencesGridView = memo<GridViewProps>(({ experiences, isLoading, onClick }) => {
  const loadMoreExperiences = useUserMemoryStore((s) => s.loadMoreExperiences);
  const experiencesHasMore = useUserMemoryStore((s) => s.experiencesHasMore);

  return (
    <GridView
      hasMore={experiencesHasMore}
      isLoading={isLoading}
      items={experiences}
      renderItem={(experience) => (
        <ExperienceCard experience={experience} onClick={() => onClick(experience)} />
      )}
      onLoadMore={loadMoreExperiences}
    />
  );
});

export default ExperiencesGridView;
