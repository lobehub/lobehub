import {
  AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
} from '../prompts/agentSkillManager';

/**
 * Agent definitions used by Agent Signal skill-management workers.
 *
 * Use when:
 * - Registering small agents that decide, refine, or consolidate skills
 * - Looking up stable identifiers for skill-management prompts
 *
 * Expects:
 * - Prompt modules expose strict JSON system roles
 *
 * Returns:
 * - Immutable agent identifiers and system roles
 */
export const agentSkillManagerAgents = {
  decision: {
    identifier: 'agent-skill-manager-decision',
    systemRole: AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  },
  consolidate: {
    identifier: 'agent-skill-manager-consolidate',
    systemRole: AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
  },
  refine: {
    identifier: 'agent-skill-manager-refine',
    systemRole: AGENT_SKILL_REFINE_SYSTEM_ROLE,
  },
} as const;
