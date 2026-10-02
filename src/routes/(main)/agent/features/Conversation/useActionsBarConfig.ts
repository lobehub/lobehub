'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig, type MessageActionSlot } from '@/features/Conversation/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * Hetero-agent (Claude Code / Codex) sessions keep the menu minimal — copy +
 * delete — because the external runtime owns the assistant message lifecycle
 * (edit / regenerate / branching / translate / share don't apply).
 * `select` remains available because forwarding / batch deletion is handled by
 * the local conversation UI and does not depend on the external runtime.
 *
 * The shared user-message baseline includes `restoreToInput`: a long
 * CLI run that errors out or loses context is exactly when you want to pull the
 * original prompt (text + attachments) back into the composer to retry. So it
 * is scoped to the hetero user menu instead of the native-agent default.
 * Codex additionally supports editing through its replacement-session path below.
 */
const HETERO_USER: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['restoreToInput', 'copy', 'divider', 'select', 'divider', 'del'],
};

/** Codex edits restart from the saved message ancestry; other runtimes retain their existing slots. */
const CODEX_USER: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['edit', ...HETERO_USER.bar],
  menu: ['edit', ...HETERO_USER.menu],
};

const HETERO_ASSISTANT: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['copy', 'divider', 'select', 'divider', 'del'],
};

/**
 * Resolves runtime-specific message action slots.
 *
 * Use when:
 * - Rendering an agent conversation's message actions.
 *
 * Expects:
 * - The active agent store identifies the conversation runtime.
 *
 * Returns:
 * - Explicit heterogeneous slots, or native-agent defaults through an empty config.
 */
export const useActionsBarConfig = (): ActionsBarConfig => {
  const isHeteroAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const providerType = useAgentStore(agentSelectors.currentAgentHeterogeneousProviderType);

  return useMemo<ActionsBarConfig>(() => {
    if (isHeteroAgent) {
      return {
        assistant: HETERO_ASSISTANT,
        assistantGroup: HETERO_ASSISTANT,
        user: providerType === 'codex' ? CODEX_USER : HETERO_USER,
      };
    }

    return {};
  }, [isHeteroAgent, providerType]);
};
