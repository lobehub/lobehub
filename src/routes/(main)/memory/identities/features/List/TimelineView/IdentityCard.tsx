import { type IdentityListItem } from '@lobechat/types';
import { memo } from 'react';

import TimeLineCard from '../../../../features/TimeLineView/TimeLineCard';
import IdentityDropdown from '../../IdentityDropdown';

interface IdentityCardProps {
  identity: IdentityListItem;
  onClick?: (identity: IdentityListItem) => void;
}

const IdentityCard = memo<IdentityCardProps>(({ identity, onClick }) => {
  return (
    <TimeLineCard
      actions={<IdentityDropdown id={identity.id} />}
      capturedAt={identity.capturedAt || identity.updatedAt || identity.createdAt}
      cate={identity.type}
      hashTags={identity.tags}
      title={identity.title}
      titleAddon={identity.role?.toLowerCase()}
      onClick={() => onClick?.(identity)}
    >
      {identity.description}
    </TimeLineCard>
  );
});

export default IdentityCard;
