import { DEFAULT_PAGE_AGENT_AVATAR } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

/**
 * Page Agent - used for document editing assistance
 */
export const PAGE_AGENT: BuiltinAgentDefinition = {
  avatar: DEFAULT_PAGE_AGENT_AVATAR,
  // No persisted model: the agent follows the account default model (see mergeAgentDefaultConfig).

  // Runtime function - generates dynamic config
  runtime: (ctx) => ({
    // Disable history count limit for page agent
    // to ensure full document context is available
    chatConfig: {
      enableHistoryCount: false,
    },
    plugins: ['lobe-page-agent', ...(ctx.plugins || [])],
    systemRole: systemRoleTemplate,
  }),

  slug: BUILTIN_AGENT_SLUGS.pageAgent,
};
