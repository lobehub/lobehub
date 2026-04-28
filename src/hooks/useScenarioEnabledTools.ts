import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';

/**
 * Enables the given built-in tools for any LLM step triggered while this hook is
 * mounted, then resets on unmount. Use from a route-level layout/page to scope
 * tool availability to a specific view.
 */
export const useScenarioEnabledTools = (...toolIds: string[]) => {
  const key = toolIds.join('|');
  const toolsRef = useRef(toolIds);
  toolsRef.current = toolIds;

  useEffect(() => {
    useChatStore.setState({ scenarioEnabledToolIds: toolsRef.current });
    return () => {
      useChatStore.setState({ scenarioEnabledToolIds: undefined });
    };
  }, [key]);
};
