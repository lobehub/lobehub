/**
 * Agent Group Prompts
 *
 * Utility functions and templates for multi-agent group orchestration scenarios.
 */

export { type AgentProfileInfo, formatAgentProfile } from './agentProfile';
export {
  buildGroupMembersXml,
  formatGroupMembers,
  type GroupContextMemberInfo,
  groupContextTemplate,
  type GroupSupervisorAgentInfo,
} from './groupContext';
