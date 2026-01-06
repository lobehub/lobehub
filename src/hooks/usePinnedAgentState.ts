'use client';

import { useAgentStore } from '@/store/agent';

export const usePinnedAgentState = () => {
  const isPinned = useAgentStore((s) => s.isAgentPinned);
  const setAgentPinned = useAgentStore((s) => s.setAgentPinned);
  const toggleAgentPinned = useAgentStore((s) => s.toggleAgentPinned);

  return [
    isPinned,
    {
      pinAgent: () => setAgentPinned(true),
      setIsPinned: setAgentPinned,
      togglePinAgent: toggleAgentPinned,
      unpinAgent: () => setAgentPinned(false),
    },
  ] as const;
};
