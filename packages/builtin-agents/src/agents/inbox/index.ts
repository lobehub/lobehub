import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { createSystemRole } from './systemRole';

/**
 * Inbox Agent - the default assistant agent for general conversations
 *
 * Note: model and provider are intentionally undefined to use user's default settings
 */
export const INBOX: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  runtime: (ctx) => ({
    plugins: [AgentDocumentsIdentifier, ...(ctx.plugins || [])],
    systemRole: createSystemRole(ctx.userLocale),
  }),

  slug: BUILTIN_AGENT_SLUGS.inbox,
};
