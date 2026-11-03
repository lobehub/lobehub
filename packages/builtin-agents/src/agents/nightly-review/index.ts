import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

/**
 * Nightly Review Agent — runs once per user-local day to inspect bounded review
 * evidence (topics, messages, tool calls, agent documents, managed skills) and
 * apply safe resource operations or create approval-gated self-review proposals.
 *
 * Tool surface (`agent-signal-review`) and per-mode adapters (review-specific
 * receipt table, idempotency namespace, brief projection) are registered in a
 * follow-up PR. Until then the agent runs with no tools — invoking it before
 * registration is dormant by design.
 */
export const NIGHTLY_REVIEW: BuiltinAgentDefinition = {
  // Background self-iteration runs on the cheap mini system model (matching the
  // legacy executeSelfIteration path), not the user's default chat model.
  persist: {
    model: DEFAULT_MINI_MODEL,
    provider: DEFAULT_MINI_PROVIDER,
  },
  runtime: {
    plugins: ['agent-signal-review'],
    systemRole:
      'You are the nightly self-review agent. Inspect bounded review evidence and apply safe resource operations (memory, skill, proposal). Be concise and evidence-driven.',
  },
  slug: BUILTIN_AGENT_SLUGS.nightlyReview,
};
