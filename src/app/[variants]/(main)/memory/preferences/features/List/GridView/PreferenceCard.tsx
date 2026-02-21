import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';
import ProgressIcon from '@/app/[variants]/(main)/memory/features/ProgressIcon';
import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';

import PreferenceDropdown from '../../PreferenceDropdown';

dayjs.extend(relativeTime);

interface PreferenceCardProps {
  onClick?: () => void;
  preference: DisplayPreferenceMemory;
}

const PreferenceCard = memo<PreferenceCardProps>(({ preference, onClick }) => {
  const { t } = useTranslation('memory');

  return (
    <GridCard
      actions={<PreferenceDropdown id={preference.id} />}
      capturedAt={preference.capturedAt || preference.updatedAt || preference.createdAt}
      cate={preference.type}
      title={preference.title}
      badges={
        <ProgressIcon
          format={(percent) => `${t('filter.sort.scorePriority')}: ${percent}%`}
          percent={(preference.scorePriority ?? 0) * 100}
        />
      }
      onClick={onClick}
    >
      {preference.conclusionDirectives}
    </GridCard>
  );
});

export default PreferenceCard;
