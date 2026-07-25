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

/**
 * Whether `agentId` is one of the builtin agent rows (inbox, the builders, the
 * page/task agents, …). Ownership actions must never be offered for these: they
 * are provisioned infrastructure, so deleting or rehoming one would break the
 * workspace (or the personal account) rather than remove user content.
 */
const isBuiltinAgent = (agentId?: string) => (s: AgentStoreState) =>
  !!agentId && Object.values(s.builtinAgentIdMap).includes(agentId);

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
