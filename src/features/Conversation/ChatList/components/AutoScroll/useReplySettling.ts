import { useCallback, useState } from 'react';

/**
 * A finished reply keeps growing: a card mounts its charts and measured layouts after the last
 * chunk. `settling` turns on when generation ends and stays on until `settle` is called (once the
 * rows stay still), so the list can keep following the tail without chasing a later expand or
 * collapse the user makes. A new generation clears it.
 */
export const useReplySettling = (isGenerating: boolean) => {
  const [settling, setSettling] = useState(false);
  const [wasGenerating, setWasGenerating] = useState(isGenerating);
  if (wasGenerating !== isGenerating) {
    setWasGenerating(isGenerating);
    setSettling(!isGenerating);
  }
  const settle = useCallback(() => setSettling(false), []);
  return { settle, settling };
};
