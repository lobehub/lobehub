import { DEFAULT_MINI_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MINI_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

/**
 * Self-Feedback-Intent Agent — handles explicit self-feedback intents declared
 * by another agent via `declareSelfFeedbackIntent`. Reads the cited evidence
 * and either applies a safe resource write or records the intent for later
 * nightly review.
 *
 * Tool surface (`agent-signal-feedback-intent`) and per-mode adapters
 * (feedback-intent receipt table, idempotency namespace) are registered in a
 * follow-up PR.
 */
export const SELF_FEEDBACK_INTENT: BuiltinAgentDefinition = {
  // Background self-iteration runs on the cheap mini system model (matching the
  // legacy executeSelfIteration path), not the user's default chat model.
  persist: {
    model: DEFAULT_MINI_MODEL,
    provider: DEFAULT_MINI_PROVIDER,
  },
  runtime: {
    plugins: ['agent-signal-feedback-intent'],
    systemRole:
      'You are the self-feedback-intent agent. Act on an explicit feedback intent declared by another agent: read cited evidence, then either apply a safe write or record a follow-up intent. Be concise and evidence-driven.',
  },
  slug: BUILTIN_AGENT_SLUGS.selfFeedbackIntent,
};
