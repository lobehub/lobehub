import { AGENT_BUILDER } from './agents/agent-builder';
import { GROUP_AGENT_BUILDER } from './agents/group-agent-builder';
import { GROUP_SUPERVISOR } from './agents/group-supervisor';
import { INBOX } from './agents/inbox';
import { PAGE_AGENT } from './agents/page-agent';
import type { BuiltinAgentDefinition, BuiltinAgentSlug, RuntimeContext } from './types';
import { BUILTIN_AGENT_SLUGS } from './types';

export * from './types';

// Agent exports
export { AGENT_BUILDER } from './agents/agent-builder';
export { GROUP_AGENT_BUILDER } from './agents/group-agent-builder';
export { GROUP_SUPERVISOR } from './agents/group-supervisor';
export { INBOX } from './agents/inbox';
export { PAGE_AGENT } from './agents/page-agent';

/**
 * All builtin agents indexed by slug
 */
export const BUILTIN_AGENTS: Record<BuiltinAgentSlug, BuiltinAgentDefinition> = {
  [BUILTIN_AGENT_SLUGS.agentBuilder]: AGENT_BUILDER,
  [BUILTIN_AGENT_SLUGS.groupAgentBuilder]: GROUP_AGENT_BUILDER,
  [BUILTIN_AGENT_SLUGS.groupSupervisor]: GROUP_SUPERVISOR,
  [BUILTIN_AGENT_SLUGS.inbox]: INBOX,
  [BUILTIN_AGENT_SLUGS.pageAgent]: PAGE_AGENT,
};

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
