import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

/**
 * Group Agent Builder - used for configuring group chat settings and managing group members
 */
export const GROUP_AGENT_BUILDER: BuiltinAgentDefinition = {
  avatar: '/avatars/agent-builder.png',

  // Persist config - stored in database
  persist: {
    model: 'claude-sonnet-4-5-20250929',
    provider: 'lobehub',
  },

  // Runtime config - static systemRole
  runtime: (ctx) => ({
    plugins: [GroupAgentBuilderIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),

  slug: BUILTIN_AGENT_SLUGS.groupAgentBuilder,
};
