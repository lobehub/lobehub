import { useState } from 'react';

/**
 * The agent the switcher reopens when the reader comes back to "Agents": the one last on screen,
 * however it got there — picked in the switcher or opened from the onboarding link — else the
 * first of `agentKeys` (the one that learned the most).
 */
export const useAgentToReopen = (value: string, agentKeys: string[]) => {
  const [lastAgent, setLastAgent] = useState<string>();
  // Adjusting state during render: whichever agent is on screen becomes the remembered one.
  if (value !== 'mine' && value !== lastAgent) setLastAgent(value);
  return lastAgent && agentKeys.includes(lastAgent) ? lastAgent : agentKeys[0];
};
