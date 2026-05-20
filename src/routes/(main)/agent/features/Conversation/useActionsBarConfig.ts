'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig, type MessageActionSlot } from '@/features/Conversation/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * Hetero-agent sessions only support copy + delete — edit / regenerate /
 * branching / translate / tts / share don't apply because the external
 * runtime owns message lifecycle.
 */
const HETERO_USER: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['copy', 'divider', 'del'],
};

const HETERO_ASSISTANT: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['copy', 'divider', 'del'],
};

export const useActionsBarConfig = (): ActionsBarConfig => {
  const isHeteroAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  return useMemo<ActionsBarConfig>(() => {
    if (isHeteroAgent) {
      return {
        assistant: HETERO_ASSISTANT,
        assistantGroup: HETERO_ASSISTANT,
        user: HETERO_USER,
      };
    }

    return {};
  }, [isHeteroAgent]);
};
