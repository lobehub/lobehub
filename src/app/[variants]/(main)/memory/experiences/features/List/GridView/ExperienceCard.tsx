import { type ExperienceListItem } from '@lobechat/types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';
import ProgressIcon from '@/app/[variants]/(main)/memory/features/ProgressIcon';

import ExperienceDropdown from '../../ExperienceDropdown';

dayjs.extend(relativeTime);

interface ExperienceCardProps {
  experience: ExperienceListItem;
  onClick: (experience: ExperienceListItem) => void;
}

const ExperienceCard = memo<ExperienceCardProps>(({ experience, onClick }) => {
  const { t } = useTranslation('memory');

  return (
    <GridCard
      actions={<ExperienceDropdown id={experience.id} />}
      capturedAt={experience.capturedAt || experience.updatedAt || experience.createdAt}
      cate={experience.type}
      title={experience.title}
      badges={
        <ProgressIcon
          format={(percent) => `${t('filter.sort.scoreConfidence')}: ${percent}%`}
          percent={(experience.scoreConfidence ?? 0) * 100}
        />
      }
      onClick={() => onClick(experience)}
    >
      {experience.keyLearning || experience.situation}
    </GridCard>
  );
});

export default ExperienceCard;
