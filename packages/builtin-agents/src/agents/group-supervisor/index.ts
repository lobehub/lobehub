import { GroupManagementIdentifier } from '@lobechat/builtin-tool-group-management';
import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { supervisorSystemRole } from './systemRole';
import type { GroupSupervisorContext } from './type';

/**
 * Replace template variables in system role
 */
const resolveSystemRole = (ctx: GroupSupervisorContext): string => {
  return supervisorSystemRole.replace('{{GROUP_TITLE}}', ctx.groupTitle);
};

/**
 * Group Supervisor - orchestrates multi-agent group conversations
 *
 * The supervisor agent is responsible for:
 * - Strategically coordinating agent participation
 * - Ensuring natural conversation flow
 * - Matching user queries to appropriate agent expertise
 *
 * Plugin Strategy:
 * - GroupManagementIdentifier is always required for group orchestration (injected in runtime)
 * - GTD is a default plugin stored in database, visible and controllable by user
 * - Deduplication is applied to avoid redundant tool registrations
 */
export const GROUP_SUPERVISOR: BuiltinAgentDefinition = {
  // Persist config - default plugins stored in database, visible and controllable by user
  persist: {
    plugins: [GTDIdentifier],
  },

  runtime: (ctx) => {
    const { groupSupervisorContext } = ctx;

    if (!groupSupervisorContext) {
      return { systemRole: '' };
    }

    // Ensure GroupManagementIdentifier is included without duplicates
    // GroupManagement is required for supervisor functionality, always injected
    const userPlugins = ctx.plugins || [];
    const plugins = userPlugins.includes(GroupManagementIdentifier)
      ? userPlugins
      : [GroupManagementIdentifier, ...userPlugins];

    return {
      chatConfig: {
        enableHistoryCount: false,
      },
      plugins,
      systemRole: resolveSystemRole(groupSupervisorContext),
    };
  },

  slug: BUILTIN_AGENT_SLUGS.groupSupervisor,
};
