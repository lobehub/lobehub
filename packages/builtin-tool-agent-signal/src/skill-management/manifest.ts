import { AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER } from '../shared/identifiers';
import { createAgentSignalManifest } from '../shared/manifest';
import { SKILL_TOOL_APIS } from '../shared/schemas';
import { systemPrompt } from './systemRole';

/**
 * Same-turn skill-management tool surface: skill-only resource reads + writes
 * (no memory, no proposal/idea recorders). Hidden, server-executed builtin tool.
 */
export const agentSignalSkillManagementManifest = createAgentSignalManifest({
  apis: [...SKILL_TOOL_APIS],
  description: 'Read managed skills and apply one safe skill create/refine from skill feedback.',
  identifier: AGENT_SIGNAL_SKILL_MANAGEMENT_IDENTIFIER,
  systemRole: systemPrompt,
  title: 'Agent Signal Skill Management',
});
