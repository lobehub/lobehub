import { eq } from 'drizzle-orm';

import { agentEvalRuns } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/**
 * System-level workspace resolver for agent-eval-run workflow handlers.
 *
 * These workflow endpoints are server-to-server callbacks dispatched from
 * QStash and do not carry a workspace context. We derive the workspace from
 * the `runId` row so downstream `AgentEvalXxxModel` / `AgentEvalRunService`
 * instances ownership-filter to the correct workspace.
 */
export const resolveAgentEvalRunWorkspace = async (
  db: LobeChatDatabase,
  runId: string,
): Promise<string | undefined> => {
  const [row] = await db
    .select({ workspaceId: agentEvalRuns.workspaceId })
    .from(agentEvalRuns)
    .where(eq(agentEvalRuns.id, runId))
    .limit(1);
  return row?.workspaceId ?? undefined;
};
