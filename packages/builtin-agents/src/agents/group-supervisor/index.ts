import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupManagementIdentifier } from '@lobechat/builtin-tool-group-management';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { supervisorSystemRole } from './systemRole';
import type { GroupSupervisorContext } from './type';

/**
 * Replace template variables in system role
 */
const resolveSystemRole = (ctx: GroupSupervisorContext): string => {
  return supervisorSystemRole
    .replace('{{GROUP_TITLE}}', ctx.groupTitle)
    .replace('{{SYSTEM_PROMPT}}', ctx.systemPrompt || '');
};

/**
 * Group Supervisor - orchestrates multi-agent group conversations
 *
 * The supervisor agent is responsible for:
 * - Strategically coordinating agent participation
 * - Ensuring natural conversation flow
 * - Matching user queries to appropriate agent expertise
 *
 * Tools:
 * - GroupManagement: orchestration (speak, broadcast, executeAgentTask, etc.)
 * - GroupAgentBuilder: member management (searchAgent, inviteAgent, createAgent, etc.)
 * - GTD: task tracking
 */
export const GROUP_SUPERVISOR: BuiltinAgentDefinition = {
  runtime: (ctx) => {
    const { groupSupervisorContext } = ctx;

    if (!groupSupervisorContext) {
      return { systemRole: '' };
    }

    return {
      chatConfig: {
        enableHistoryCount: false,
      },
      plugins: [GroupManagementIdentifier, GroupAgentBuilderIdentifier, ...(ctx.plugins || [])],
      systemRole: resolveSystemRole(groupSupervisorContext),
    };
  },

  slug: BUILTIN_AGENT_SLUGS.groupSupervisor,
};
