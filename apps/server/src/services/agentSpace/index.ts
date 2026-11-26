import { AgentSpaceRepository } from '@/database/repositories/agentSpace';
import type { LobeChatDatabase } from '@/database/type';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { after } from '@/server/utils/scheduleAfterResponse';

/** Bounds the work one page view can trigger; the next view continues. */
const MAX_BATCHES_PER_ACCESS = 5;

interface AgentSpaceMigrationParams {
  agentId: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Moves part of an agent's documents into its dedicated knowledge base.
 *
 * Returns:
 * - The number of documents moved. Zero when `agent_knowledge_space` is off.
 */
export const migrateAgentSpace = async ({
  agentId,
  db,
  userId,
  workspaceId,
}: AgentSpaceMigrationParams): Promise<number> => {
  const { enableAgentKnowledgeSpace } = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  if (!enableAgentKnowledgeSpace) return 0;

  const repository = new AgentSpaceRepository(db, userId, workspaceId);
  let total = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_ACCESS; batch += 1) {
    const { done, migrated, skipped } = await repository.migrateBatch(agentId);
    total += migrated;
    if (done || skipped) break;
  }

  return total;
};

/**
 * Runs {@link migrateAgentSpace} after the response, so listing documents never
 * waits on it or fails because of it.
 */
export const scheduleAgentSpaceMigration = (params: AgentSpaceMigrationParams) => {
  after(async () => {
    try {
      await migrateAgentSpace(params);
    } catch (error) {
      console.error('[AgentSpace] Failed to migrate agent documents:', error);
    }
  });
};
