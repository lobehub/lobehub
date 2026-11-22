import type { ModalInstance } from '@lobehub/ui';
import { useEffect, useRef } from 'react';

/**
 * Opens the agent's advanced settings modal. The modal edits the active agent,
 * so it closes when the sidebar moves to another agent or leaves the profile group.
 */
export const useAgentSettingsModal = (agentId: string) => {
  const modalRef = useRef<ModalInstance | null>(null);
  const latestOpenRef = useRef(0);

  useEffect(
    () => () => {
      latestOpenRef.current += 1;
      modalRef.current?.close();
      modalRef.current = null;
    },
    [agentId],
  );

  return async () => {
    const openId = ++latestOpenRef.current;
    // Loaded on demand so the settings form stays out of the sidebar chunk.
    const { openAgentSettingsModal } =
      await import('@/routes/(main)/agent/profile/features/AgentSettings');
    if (openId !== latestOpenRef.current) return;

    modalRef.current?.close();
    modalRef.current = openAgentSettingsModal();
  };
};
