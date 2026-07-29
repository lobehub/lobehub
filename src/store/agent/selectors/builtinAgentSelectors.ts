import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID } from '@lobechat/const';

import { type AgentStoreState } from '@/store/agent/initialState';

/**
 * Get builtin agent ID by slug
 */
const getBuiltinAgentId = (slug: string) => (s: AgentStoreState) => s.builtinAgentIdMap[slug];

/**
 * Check if a builtin agent is initialized by slug
 */
const isBuiltinAgentInit = (slug: string) => (s: AgentStoreState) => !!s.builtinAgentIdMap[slug];

/**
 * Get page agent ID (convenience selector)
 */
const pageAgentId = (s: AgentStoreState) => s.builtinAgentIdMap[BUILTIN_AGENT_SLUGS.pageAgent];

/**
 * Get task agent ID (convenience selector)
 */
const taskAgentId = (s: AgentStoreState) => s.builtinAgentIdMap[BUILTIN_AGENT_SLUGS.taskAgent];

/**
 * Get agent builder ID (convenience selector)
 */
const agentBuilderId = (s: AgentStoreState) =>
  s.builtinAgentIdMap[BUILTIN_AGENT_SLUGS.agentBuilder];

/**
 * Get group agent builder ID (convenience selector)
 */
const groupAgentBuilderId = (s: AgentStoreState) =>
  s.builtinAgentIdMap[BUILTIN_AGENT_SLUGS.groupAgentBuilder];

/**
 * Get inbox agent id from builtinAgentIdMap
 */
const inboxAgentId = (s: AgentStoreState) => s.builtinAgentIdMap[INBOX_SESSION_ID];

/**
 * Check if inbox agent is initialized
 */
const isInboxAgentConfigInit = (s: AgentStoreState) => !!s.builtinAgentIdMap[INBOX_SESSION_ID];

/**
 * Check if current active agent is the inbox agent
 */
const isInboxAgent = (s: AgentStoreState) => {
  const id = inboxAgentId(s);
  return !!id && s.activeAgentId === id;
};

/** Every provisioned builtin slug, for classifying a hydrated agent row. */
const BUILTIN_SLUG_SET: ReadonlySet<string> = new Set<string>([
  ...Object.values(BUILTIN_AGENT_SLUGS),
  INBOX_SESSION_ID,
]);

/**
 * Whether `agentId` is one of the builtin agent rows (inbox, the builders, the
 * page/task agents, …). Ownership actions must never be offered for these: they
 * are provisioned infrastructure, so deleting or rehoming one would break the
 * workspace (or the personal account) rather than remove user content.
 *
 * Read from the hydrated row's own `slug` + `virtual` — the same pair the server
 * uses (`isCollaborativeBuiltinAgent`), so a legacy ordinary agent that merely
 * holds a reserved slug stays ordinary here too and keeps its owner's Delete
 * action. `builtinAgentIdMap` only holds the builtins this session happened to
 * initialize, so opening e.g. `/agent/<page-agent-id>/profile` without having
 * visited the Page editor would otherwise misclassify a real builtin as ordinary
 * content; it remains the fallback for rows whose config is not hydrated (the
 * agent *list* payload carries neither marker).
 */
const isBuiltinAgent = (agentId?: string) => (s: AgentStoreState) => {
  if (!agentId) return false;

  const agent = s.agentMap[agentId];
  if (agent?.slug && agent.virtual !== undefined) {
    return agent.virtual === true && BUILTIN_SLUG_SET.has(agent.slug);
  }

  return Object.values(s.builtinAgentIdMap).includes(agentId);
};

/**
 * Get web onboarding agent id (convenience selector)
 */
const webOnboardingAgentId = (s: AgentStoreState) =>
  s.builtinAgentIdMap[BUILTIN_AGENT_SLUGS.webOnboarding];

/**
 * Check if current active agent is the web onboarding agent
 */
const isOnboardingAgent = (s: AgentStoreState) => {
  const id = webOnboardingAgentId(s);
  return !!id && s.activeAgentId === id;
};

export const builtinAgentSelectors = {
  agentBuilderId,
  getBuiltinAgentId,
  groupAgentBuilderId,
  inboxAgentId,
  isBuiltinAgent,
  isBuiltinAgentInit,
  isInboxAgent,
  isInboxAgentConfigInit,
  isOnboardingAgent,
  pageAgentId,
  taskAgentId,
  webOnboardingAgentId,
};
