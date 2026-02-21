import { type IdentityListItem } from '@lobechat/types';
import { memo } from 'react';

import GridCard from '@/app/[variants]/(main)/memory/features/GridView/GridCard';

import IdentityDropdown from '../../IdentityDropdown';

interface IdentityCardProps {
  identity: IdentityListItem;
  onClick?: (identity: IdentityListItem) => void;
}

const IdentityCard = memo<IdentityCardProps>(({ identity, onClick }) => {
  return (
    <GridCard
      actions={<IdentityDropdown id={identity.id} />}
      cate={identity.type}
      hashTags={identity.tags}
      title={identity.title}
      titleAddon={identity.role?.toLowerCase()}
      onClick={() => onClick?.(identity)}
    >
      {identity.description}
    </GridCard>
  );
});

export default IdentityCard;
