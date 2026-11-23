import { Avatar } from '@lobehub/ui';
import { memo } from 'react';

import IconTile from './IconTile';

/** A Marketplace Agent's picture (illustration, emoji or image) on the Surface tile. */
const MarketAgentAvatar = memo<{ avatar?: string; size: number; title: string }>(
  ({ avatar, size, title }) => (
    <IconTile size={size}>
      <Avatar
        alt={title}
        avatar={avatar || title.slice(0, 1)}
        background={'transparent'}
        shape={'square'}
        size={Math.round(size * 0.78)}
      />
    </IconTile>
  ),
);

MarketAgentAvatar.displayName = 'MarketplaceAgentAvatar';

export default MarketAgentAvatar;
