import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

const SELF_ITERATION_TOOL_IDENTIFIER = 'agent-signal-self-iteration';

/**
 * Self-Iteration Agent - shared execAgent target for nightly review, post-turn
 * reflection, and declared feedback intents.
 *
 * All three flows share the same tool surface (`agent-signal-self-iteration`);
 * the mode-specific guidance is supplied per-call by the caller's prompt builder,
 * so the agent itself stays neutral.
 */
export const SELF_ITERATION: BuiltinAgentDefinition = {
  runtime: {
    plugins: [SELF_ITERATION_TOOL_IDENTIFIER],
    systemRole:
      'You are the self-iteration agent. Follow the mode-specific instructions in the user prompt and apply safe resource operations using the provided self-iteration tools. Be concise and evidence-driven.',
  },
  slug: BUILTIN_AGENT_SLUGS.selfIteration,
};
