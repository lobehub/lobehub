import { memo } from 'react';

import TimeLineCard from '@/app/[variants]/(main)/memory/features/TimeLineView/TimeLineCard';
import { type DisplayIdentityMemory } from '@/database/repositories/userMemory';

import IdentityDropdown from '../../IdentityDropdown';

interface IdentityCardProps {
  identity: DisplayIdentityMemory;
  onClick?: (identity: DisplayIdentityMemory) => void;
}

const IdentityCard = memo<IdentityCardProps>(({ identity, onClick }) => {
  return (
    <TimeLineCard
      actions={<IdentityDropdown id={identity.id} />}
      cate={identity.type}
      hashTags={identity.tags}
      onClick={() => onClick?.(identity)}
      title={identity.role}
      capturedAt={identity.capturedAt || identity.updatedAt || identity.createdAt}
    >
      {identity.description}
    </TimeLineCard>
  );
});

export default IdentityCard;
