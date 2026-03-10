import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRoleTemplate } from './systemRole';

/**
 * Page Agent - used for document editing assistance
 */
export const PAGE_AGENT: BuiltinAgentDefinition = {
  avatar: '/avatars/doc-copilot.png',
  // Persist config - stored in database
  persist: {
    model: DEFAULT_MODEL,
    provider: DEFAULT_PROVIDER,
  },

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
