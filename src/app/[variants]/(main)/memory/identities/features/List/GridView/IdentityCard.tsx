import { memo } from 'react';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';
import { type DisplayIdentityMemory } from '@/database/repositories/userMemory';

import IdentityDropdown from '../../IdentityDropdown';

interface IdentityCardProps {
  identity: DisplayIdentityMemory;
  onClick?: (identity: DisplayIdentityMemory) => void;
}

const IdentityCard = memo<IdentityCardProps>(({ identity, onClick }) => {
  return (
    <GridCard
      actions={<IdentityDropdown id={identity.id} />}
      cate={identity.type}
      hashTags={identity.tags}
      onClick={() => onClick?.(identity)}
      title={identity.role}
    >
      {identity.description}
    </GridCard>
  );
});

export default IdentityCard;
