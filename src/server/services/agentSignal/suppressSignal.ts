import { SELF_ITERATION_AGENT_SLUGS } from '@lobechat/builtin-agents';

/**
 * Returns true when the agent run should not trigger downstream
 * AgentSignal source events.
 *
 * Suppression applies when:
 * - The slug belongs to SELF_ITERATION_AGENT_SLUGS (currently just `self-iteration`).
 * - The caller passes `appContext.suppressSignal: true` explicitly.
 *
 * Background system agents must always pass this so that their own
 * execAgent invocations do not re-enter the AgentSignal pipeline and
 * trigger infinite self-iteration loops.
 */
export const shouldSuppressSignal = (options: {
  appContext?: { suppressSignal?: boolean };
  slug?: string;
}): boolean => {
  if (options.appContext?.suppressSignal === true) return true;
  if (options.slug && SELF_ITERATION_AGENT_SLUGS.has(options.slug as never)) return true;

  return false;
};
