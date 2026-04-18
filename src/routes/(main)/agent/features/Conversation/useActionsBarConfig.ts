'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig, type MessageActionSlot } from '@/features/Conversation/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

/**
 * Hetero-agent (ACP) sessions only support copy + delete — edit / regenerate /
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
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  const hasACPProvider = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  return useMemo<ActionsBarConfig>(() => {
    if (hasACPProvider) {
      return {
        assistant: HETERO_ASSISTANT,
        assistantGroup: HETERO_ASSISTANT,
        user: HETERO_USER,
      };
    }

    // Dev mode adds `branching` to the default bars. Everything else falls
    // back to each role's component-level defaults.
    if (isDevMode) {
      return {
        assistant: { bar: ['edit', 'copy', 'branching'] },
        user: { bar: ['regenerate', 'edit', 'copy', 'branching'] },
      };
    }

    return {};
  }, [hasACPProvider, isDevMode]);
};
