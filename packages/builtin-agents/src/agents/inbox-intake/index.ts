import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';
import { UserInteractionIdentifier } from '@lobechat/builtin-tool-user-interaction';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

/**
 * Classifies an unstructured Inbox capture into atomic items and proposes downstream signals.
 *
 * Use when:
 * - A raw note may contain multiple intents or destinations.
 * - Downstream agents need a stable routing envelope before acting.
 *
 * Expects:
 * - The user input contains the complete source note and optional execution mode.
 *
 * Returns:
 * - A proposal-only JSON envelope unless the caller explicitly authorizes apply mode.
 */
export const INBOX_INTAKE: BuiltinAgentDefinition = {
  avatar: '/avatars/lobe-ai.png',
  runtime: (ctx) => ({
    plugins: [AgentDocumentsIdentifier, UserInteractionIdentifier, ...(ctx.plugins || [])],
    systemRole,
  }),
  slug: BUILTIN_AGENT_SLUGS.inboxIntake,
};
