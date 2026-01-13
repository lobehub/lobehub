import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';
import { NotebookIdentifier } from '@lobechat/builtin-tool-notebook';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

/**
 * Inbox Agent - the default assistant agent for general conversations
 *
 * Note: model and provider are intentionally undefined to use user's default settings
 */
export const INBOX: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  runtime: (ctx) => ({
    plugins: [GTDIdentifier, NotebookIdentifier, ...(ctx.plugins || [])],
    systemRole: systemRole,
  }),

  slug: BUILTIN_AGENT_SLUGS.inbox,
};
