import { AGENT_BUILDER } from './agents/agent-builder';
import { GROUP_AGENT_BUILDER } from './agents/group-agent-builder';
import { GROUP_SUPERVISOR } from './agents/group-supervisor';
import { INBOX } from './agents/inbox';
import { PAGE_AGENT } from './agents/page-agent';
import { SELF_ITERATION } from './agents/self-iteration';
import { TASK_AGENT } from './agents/task-agent';
import { WEB_ONBOARDING } from './agents/web-onboarding';
import type { BuiltinAgentDefinition, BuiltinAgentSlug, RuntimeContext } from './types';
import { BUILTIN_AGENT_SLUGS } from './types';

export * from './types';

// Agent exports
export { AGENT_BUILDER } from './agents/agent-builder';
export { GROUP_AGENT_BUILDER } from './agents/group-agent-builder';
export { GROUP_SUPERVISOR } from './agents/group-supervisor';
export { INBOX } from './agents/inbox';
export { PAGE_AGENT } from './agents/page-agent';
export { SELF_ITERATION } from './agents/self-iteration';
export { TASK_AGENT } from './agents/task-agent';
export { WEB_ONBOARDING } from './agents/web-onboarding';

/**
 * All builtin agents indexed by slug
 */
export const BUILTIN_AGENTS: Record<BuiltinAgentSlug, BuiltinAgentDefinition> = {
  [BUILTIN_AGENT_SLUGS.agentBuilder]: AGENT_BUILDER,
  [BUILTIN_AGENT_SLUGS.groupAgentBuilder]: GROUP_AGENT_BUILDER,
  [BUILTIN_AGENT_SLUGS.groupSupervisor]: GROUP_SUPERVISOR,
  [BUILTIN_AGENT_SLUGS.inbox]: INBOX,
  [BUILTIN_AGENT_SLUGS.pageAgent]: PAGE_AGENT,
  [BUILTIN_AGENT_SLUGS.selfIteration]: SELF_ITERATION,
  [BUILTIN_AGENT_SLUGS.taskAgent]: TASK_AGENT,
  [BUILTIN_AGENT_SLUGS.webOnboarding]: WEB_ONBOARDING,
};

/**
 * Slugs that belong to the self-iteration family.
 * Used by AgentSignal to skip re-triggering signal events
 * for builtin background runs (suppressSignal behaviour).
 */
export const SELF_ITERATION_AGENT_SLUGS = new Set<BuiltinAgentSlug>([
  BUILTIN_AGENT_SLUGS.selfIteration,
]);

/**
 * Get persist config for a builtin agent (for DB operations)
 * @param slug - The builtin agent slug
 * @returns Persist config with slug or undefined if not found
 */
export const getAgentPersistConfig = (slug: string) => {
  const agent = BUILTIN_AGENTS[slug as BuiltinAgentSlug];
  if (!agent) return undefined;

  return { ...agent.persist, slug: agent.slug };
};

/**
 * Get runtime config for a builtin agent
 * @param slug - The builtin agent slug
 * @param ctx - Runtime context
 * @returns Runtime result or undefined if not found
 */
export const getAgentRuntimeConfig = (slug: string, ctx: RuntimeContext) => {
  const agent = BUILTIN_AGENTS[slug as BuiltinAgentSlug];
  if (!agent) return undefined;

  // Handle both function and plain object forms
  const runtime = agent.runtime;
  return typeof runtime === 'function' ? runtime(ctx) : runtime;
};
