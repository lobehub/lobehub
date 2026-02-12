'use client';

import { type ExperienceListItem } from '@lobechat/types';
import { memo } from 'react';

import { useUserMemoryStore } from '@/store/userMemory';

import { TimelineView as GenericTimelineView } from '../../../../features/TimeLineView';
import { PeriodHeader, TimelineItemWrapper } from '../../../../features/TimeLineView/PeriodGroup';
import ExperienceCard from './ExperienceCard';

interface ExperienceTimelineViewProps {
  experiences: ExperienceListItem[];
  isLoading?: boolean;
  onCardClick: (experience: ExperienceListItem) => void;
}

const ExperienceTimelineView = memo<ExperienceTimelineViewProps>(
  ({ experiences, isLoading, onCardClick }) => {
    const loadMoreExperiences = useUserMemoryStore((s) => s.loadMoreExperiences);
    const experiencesHasMore = useUserMemoryStore((s) => s.experiencesHasMore);

    return (
      <GenericTimelineView
        data={experiences}
        groupBy="day"
        hasMore={experiencesHasMore}
        isLoading={isLoading}
        renderHeader={(periodKey) => <PeriodHeader groupBy="day" periodKey={periodKey} />}
        renderItem={(experience) => (
          <TimelineItemWrapper>
            <ExperienceCard experience={experience} onClick={onCardClick} />
          </TimelineItemWrapper>
        )}
        onLoadMore={loadMoreExperiences}
      />
    );
  },
);

export default ExperienceTimelineView;
