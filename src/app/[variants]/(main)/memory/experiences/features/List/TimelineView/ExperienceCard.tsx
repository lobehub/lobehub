import { type ExperienceListItem } from '@lobechat/types';
import { memo } from 'react';

import TimeLineCard from '@/app/[variants]/(main)/memory/features/TimeLineView/TimeLineCard';

import ExperienceDropdown from '../../ExperienceDropdown';

interface ExperienceCardProps {
  experience: ExperienceListItem;
  onClick: (experience: ExperienceListItem) => void;
}

const ExperienceCard = memo<ExperienceCardProps>(({ experience, onClick }) => {
  return (
    <TimeLineCard
      actions={<ExperienceDropdown id={experience.id} />}
      capturedAt={experience.capturedAt || experience.updatedAt || experience.createdAt}
      cate={experience.type}
      hashTags={experience.tags}
      title={experience.title}
      onClick={() => onClick(experience)}
    >
      {experience.keyLearning || experience.situation}
    </TimeLineCard>
  );
});

export default ExperienceCard;
