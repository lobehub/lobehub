import { useState } from 'react';

import AgentAvatar from './index';

/**
 * An Agent author's avatar in the message list: still until hovered, then it plays its idle loop
 * and turns toward the pointer. A feed holds many of them, so only the hovered one animates.
 */
export function HoverFollowAgentAvatar({
  agentId,
  avatar,
  name,
  size,
}: {
  agentId: string;
  avatar?: string | null;
  name?: string | null;
  size: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      data-hovered={hovered || undefined}
      style={{ display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AgentAvatar
        agentId={agentId}
        animated={hovered}
        avatar={avatar}
        followPointer={hovered}
        name={name}
        shape={'circle'}
        size={size}
      />
    </span>
  );
}
