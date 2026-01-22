import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';

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
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  },

  // Runtime config - static systemRole
  runtime: (ctx) => ({
    plugins: [GroupAgentBuilderIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),

  slug: BUILTIN_AGENT_SLUGS.groupAgentBuilder,
};
