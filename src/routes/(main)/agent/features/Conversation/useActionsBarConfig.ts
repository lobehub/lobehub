'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig, type MessageActionSlot } from '@/features/Conversation/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * Hetero-agent (Claude Code / Codex) sessions keep the menu minimal — copy +
 * delete — because the external runtime owns the assistant message lifecycle
 * (edit / regenerate / branching / translate / tts / share don't apply).
 *
 * The one user-message action that DOES belong here is `restoreToInput`: a long
 * CLI run that errors out or loses context is exactly when you want to pull the
 * original prompt (text + attachments) back into the composer to retry. So it
 * is scoped to the hetero user menu instead of the native-agent default.
 */
const HETERO_USER: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['restoreToInput', 'copy', 'divider', 'del'],
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
