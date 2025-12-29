import { memo } from 'react';

import TimeLineCard from '@/app/[variants]/(main)/memory/features/TimeLineView/TimeLineCard';
import { type DisplayExperienceMemory } from '@/database/repositories/userMemory';

import ExperienceDropdown from '../../ExperienceDropdown';

interface ExperienceCardProps {
  experience: DisplayExperienceMemory;
  onClick: (experience: DisplayExperienceMemory) => void;
}

const ExperienceCard = memo<ExperienceCardProps>(({ experience, onClick }) => {
  return (
    <TimeLineCard
      actions={<ExperienceDropdown id={experience.id} />}
      cate={experience.type}
      hashTags={experience.tags}
      onClick={() => onClick(experience)}
      title={experience.title}
      capturedAt={experience.capturedAt || experience.updatedAt || experience.createdAt}
    >
      {experience.keyLearning || experience.situation}
    </TimeLineCard>
  );
});

export default ExperienceCard;
