import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

import { AgentModel } from '@/database/models/agent';
import { QuickNoteModel } from '@/database/models/quickNote';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Resolves the Agent that works on a user's Quick Notes.
 *
 * Use when:
 * - Picking the assignee of a Quick Note Task (research Proposal or Dive).
 *
 * Expects:
 * - The analyze agent configured in Quick Note settings may have been deleted since.
 *
 * Returns:
 * - The configured analyze agent id when it still exists, otherwise the builtin Quick Note agent.
 */
export const resolveQuickNoteAgentId = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<string> => {
  const settings = await QuickNoteModel.getAnalyzeSettings(db, userId);
  const agentModel = new AgentModel(db, userId, workspaceId);

  if (settings.analyzeAgentId) {
    const configured = await agentModel.getAgentConfig(settings.analyzeAgentId);
    if (configured?.id) return configured.id;
  }

  const builtin = await agentModel.getBuiltinAgent(BUILTIN_AGENT_SLUGS.quickNoteAnalyze);
  if (!builtin) throw new Error('Builtin Quick Note agent is not available');

  return builtin.id;
};
