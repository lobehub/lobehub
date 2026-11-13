'use client';

import { useMemo } from 'react';

import { type ActionsBarConfig, type MessageActionSlot } from '@/features/Conversation/types';
import { useCanEditCodexMessage } from '@/hooks/useCanEditCodexMessage';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * Hetero-agent (Claude Code / Codex) sessions keep the menu minimal — copy +
 * delete — because the external runtime owns the assistant message lifecycle
 * (assistant edit / branching / translate / share don't apply).
 * Regenerate was previously excluded too; Codex now uses the existing
 * heterogeneous rerun path, which preserves the user prompt and attachments.
 * `select` remains available because forwarding / batch deletion is handled by
 * the local conversation UI and does not depend on the external runtime.
 *
 * The one user-message action that DOES belong here is `restoreToInput`: a long
 * CLI run that errors out or loses context is exactly when you want to pull the
 * original prompt (text + attachments) back into the composer to retry. So it
 * is scoped to the hetero user menu instead of the native-agent default.
 */
const HETERO_USER: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['restoreToInput', 'copy', 'divider', 'select', 'divider', 'del'],
};

/** Codex user edits run a replacement prompt while preserving the original history. */
const CODEX_USER: typeof HETERO_USER = {
  bar: ['edit', ...HETERO_USER.bar],
  menu: ['edit', ...HETERO_USER.menu],
};

const HETERO_ASSISTANT: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['copy', 'divider', 'select', 'divider', 'del'],
};

/** Codex replies can reuse the existing heterogeneous regeneration path. */
const CODEX_ASSISTANT: typeof HETERO_ASSISTANT = {
  bar: ['copy', 'regenerate'],
  menu: ['regenerate', ...HETERO_ASSISTANT.menu],
};

/**
 * Selects message actions supported by the current agent runtime.
 *
 * Use when:
 * - Configuring the main conversation's message action bars.
 *
 * Expects:
 * - The active agent's configuration is available in the agent store.
 *
 * Returns:
 * - Runtime-specific overrides, or native message defaults via an empty object.
 */
export const useActionsBarConfig = (): ActionsBarConfig => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  const canEditCodex = useCanEditCodexMessage(agentId);
  const isHeteroAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  const providerType = useAgentStore(agentSelectors.currentAgentHeterogeneousProviderType);

  return useMemo<ActionsBarConfig>(() => {
    if (isHeteroAgent) {
      return {
        assistant: providerType === 'codex' ? CODEX_ASSISTANT : HETERO_ASSISTANT,
        assistantGroup: providerType === 'codex' ? CODEX_ASSISTANT : HETERO_ASSISTANT,
        user: canEditCodex ? CODEX_USER : HETERO_USER,
      };
    }

    return {};
  }, [canEditCodex, isHeteroAgent, providerType]);
};
