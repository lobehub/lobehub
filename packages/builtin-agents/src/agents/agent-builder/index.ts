import { AgentBuilderIdentifier } from '@lobechat/builtin-tool-agent-builder';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

/**
 * Agent Builder - used for configuring AI agents through natural conversation
 */
export const AGENT_BUILDER: BuiltinAgentDefinition = {
  avatar: '/avatars/agent-builder.png',

  // Persist config - stored in database
  persist: {
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  },

  // Runtime config - static systemRole
  runtime: (ctx) => ({
    plugins: [AgentBuilderIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),

  slug: BUILTIN_AGENT_SLUGS.agentBuilder,
};
