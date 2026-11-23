import { memo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';

import IconTile from './IconTile';

/**
 * A Marketplace Agent's picture on the Surface tile: its image or emoji, else the generated
 * character (picked as `agent-avatar:<shape>:<color>`, or seeded by its identifier). With
 * `followPointer` the character comes alive and turns toward the pointer.
 */
const MarketAgentAvatar = memo<{
  avatar?: string;
  followPointer?: boolean;
  identifier: string;
  size: number;
  title: string;
}>(({ avatar, followPointer, identifier, size, title }) => (
  <IconTile size={size}>
    <AgentAvatar
      agentId={identifier}
      animated={followPointer}
      avatar={avatar}
      background={'transparent'}
      followPointer={followPointer}
      name={title}
      shape={'square'}
      size={Math.round(size * 0.78)}
    />
  </IconTile>
));

MarketAgentAvatar.displayName = 'MarketplaceAgentAvatar';

export default MarketAgentAvatar;
