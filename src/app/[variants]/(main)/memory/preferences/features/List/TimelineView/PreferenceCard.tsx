import { memo } from 'react';

import TimeLineCard from '@/app/[variants]/(main)/memory/features/TimeLineView/TimeLineCard';
import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';

import PreferenceDropdown from '../../PreferenceDropdown';

interface PreferenceCardProps {
  onClick?: () => void;
  preference: DisplayPreferenceMemory;
}

const PreferenceCard = memo<PreferenceCardProps>(({ preference, onClick }) => {
  return (
    <TimeLineCard
      actions={<PreferenceDropdown id={preference.id} />}
      capturedAt={preference.capturedAt || preference.updatedAt || preference.createdAt}
      cate={preference.type}
      hashTags={preference.tags}
      title={preference.title}
      onClick={onClick}
    >
      {preference.conclusionDirectives}
    </TimeLineCard>
  );
});

export default PreferenceCard;
