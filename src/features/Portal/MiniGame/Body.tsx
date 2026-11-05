'use client';

import { memo } from 'react';

import MiniGame from '@/features/MiniGame';
import { useCloseUnavailableMiniGame } from '@/features/MiniGame/useMiniGameAvailable';
import { useAgentStore } from '@/store/agent';

const Body = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const available = useCloseUnavailableMiniGame(agentId ?? '');

  return available ? <MiniGame /> : null;
});

Body.displayName = 'MiniGamePortalBody';

export default Body;
