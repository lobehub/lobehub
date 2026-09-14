import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';

import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';
import { systemRole } from './systemRole';

/**
 * Converts Inbox knowledge candidates into durable document and relationship proposals.
 *
 * Use when:
 * - An intake signal identifies reusable knowledge, evidence, or a decision.
 * - A raw capture needs a suggested Page structure without immediate persistence.
 *
 * Expects:
 * - Source text plus any routing evidence produced by the intake agent.
 *
 * Returns:
 * - Candidate knowledge artifacts and relationships without writing by default.
 */
export const KNOWLEDGE_CURATOR: BuiltinAgentDefinition = {
  avatar: '/avatars/doc-copilot.png',
  runtime: (ctx) => ({
    plugins: [AgentDocumentsIdentifier, ...(ctx.plugins || [])],
    systemRole,
  }),
  slug: BUILTIN_AGENT_SLUGS.knowledgeCurator,
};
