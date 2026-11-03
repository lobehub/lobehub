import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

/**
 * Self-Reflection Agent — runs after a turn or scoped operation to inspect
 * immediate reflection evidence and either record a durable memory / skill
 * write or capture an advisory feedback intent for later nightly review.
 *
 * Tool surface (`agent-signal-reflection`) and per-mode adapters (reflection
 * receipt table, idempotency namespace) are registered in a follow-up PR.
 */
export const SELF_REFLECTION: BuiltinAgentDefinition = {
  // Background self-iteration runs on the cheap mini system model (matching the
  // legacy executeSelfIteration path), not the user's default chat model.
  persist: {
    model: DEFAULT_MINI_MODEL,
    provider: DEFAULT_MINI_PROVIDER,
  },
  runtime: {
    plugins: ['agent-signal-reflection'],
    systemRole:
      'You are the post-turn self-reflection agent. Inspect bounded reflection evidence and record either a durable memory/skill write or an advisory feedback intent. Be concise and evidence-driven.',
  },
  slug: BUILTIN_AGENT_SLUGS.selfReflection,
};
