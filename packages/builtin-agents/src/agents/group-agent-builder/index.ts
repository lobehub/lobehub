import { GroupAgentBuilderIdentifier } from '@lobechat/builtin-tool-group-agent-builder';
import { DEFAULT_AGENT_BUILDER_AVATAR } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

/**
 * Group Agent Builder - used for configuring group chat settings and managing group members
 */
export const GROUP_AGENT_BUILDER: BuiltinAgentDefinition = {
  avatar: DEFAULT_AGENT_BUILDER_AVATAR,

  // No persisted model: the agent follows the account default model (see mergeAgentDefaultConfig).

  // Runtime config - static systemRole
  runtime: (ctx) => ({
    plugins: [GroupAgentBuilderIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),

  slug: BUILTIN_AGENT_SLUGS.groupAgentBuilder,
};
