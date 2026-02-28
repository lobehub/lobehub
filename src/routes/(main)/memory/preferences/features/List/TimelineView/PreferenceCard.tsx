import { memo } from 'react';

import { type DisplayPreferenceMemory } from '@/database/repositories/userMemory';
import TimeLineCard from '@/routes/(main)/memory/features/TimeLineView/TimeLineCard';

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
