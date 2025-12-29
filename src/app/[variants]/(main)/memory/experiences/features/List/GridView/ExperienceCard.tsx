import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';
import ProgressIcon from '@/app/[variants]/(main)/memory/features/ProgressIcon';
import { type DisplayExperienceMemory } from '@/database/repositories/userMemory';

import ExperienceDropdown from '../../ExperienceDropdown';

dayjs.extend(relativeTime);

interface ExperienceCardProps {
  experience: DisplayExperienceMemory;
  onClick: (experience: DisplayExperienceMemory) => void;
}

const ExperienceCard = memo<ExperienceCardProps>(({ experience, onClick }) => {
  const { t } = useTranslation('memory');

  return (
    <GridCard
      actions={<ExperienceDropdown id={experience.id} />}
      badges={
        <ProgressIcon
          format={(percent) => `${t('filter.sort.scoreConfidence')}: ${percent}%`}
          percent={(experience.scoreConfidence ?? 0) * 100}
        />
      }
      cate={experience.type}
      onClick={() => onClick(experience)}
      title={experience.title}
      capturedAt={experience.capturedAt || experience.updatedAt || experience.createdAt}
    >
      {experience.keyLearning || experience.situation}
    </GridCard>
  );
});

export default ExperienceCard;
