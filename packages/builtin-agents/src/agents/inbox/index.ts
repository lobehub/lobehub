import { GTDIdentifier } from '@lobechat/builtin-tool-gtd';
import { NotebookIdentifier } from '@lobechat/builtin-tool-notebook';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

/**
 * Inbox Agent - the default assistant agent for general conversations
 *
 * Note: model and provider are intentionally undefined to use user's default settings
 *
 * Default Plugins:
 * - GTD and Notebook are included as default plugins via persist config
 * - These will be stored in database and visible in UI, allowing users to disable them
 * - Users can see these tools are enabled and choose to turn them off if desired
 */
export const INBOX: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',

  // Persist config - default plugins stored in database, visible and controllable by user
  persist: {
    plugins: [GTDIdentifier, NotebookIdentifier],
  },

  runtime: (ctx) => ({
    // Use plugins from ctx (which comes from database, including user modifications)
    plugins: ctx.plugins || [],
    systemRole: systemRole,
  }),

  slug: BUILTIN_AGENT_SLUGS.inbox,
};
