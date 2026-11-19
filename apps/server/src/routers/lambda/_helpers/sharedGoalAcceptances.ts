import type { GoalNodeAcceptance } from '@lobechat/types';
import pMap from 'p-map';

import type { LobeChatDatabase } from '@/database/type';
import { AcceptanceService, buildAcceptanceCheckUnion } from '@/server/services/verify';

import type { SharedGoalAcceptanceInput } from './sharedGoalView';

/** Cap on concurrent acceptance reads while building one shared view. */
const ACCEPTANCE_READ_CONCURRENCY = 5;

/**
 * Read each node's Acceptance as criterion / verdict / summary rows.
 *
 * Runs AS the share owner: the visitor owns nothing, so the acceptance models'
 * ownership scope has to be the owner's. The access decision was already made
 * by `findByShareIdWithAccessCheck`.
 */
export const readSharedGoalAcceptances = async (
  db: LobeChatDatabase,
  owner: { userId: string; workspaceId?: string },
  nodeAcceptances: Record<string, GoalNodeAcceptance> | undefined,
): Promise<{
  acceptances: Record<string, SharedGoalAcceptanceInput>;
  nodeAcceptanceIds: Record<string, string>;
}> => {
  const nodeAcceptanceIds: Record<string, string> = {};
  for (const [nodeId, acceptance] of Object.entries(nodeAcceptances ?? {})) {
    nodeAcceptanceIds[nodeId] = acceptance.id;
  }

  const service = new AcceptanceService(db, owner.userId, owner.workspaceId);
  const entries = await pMap(
    Object.values(nodeAcceptances ?? {}),
    async ({ id, status }): Promise<[string, SharedGoalAcceptanceInput]> => {
      const { results, runs } = await service.loadRounds(id);
      const checks = buildAcceptanceCheckUnion(
        runs.map((run) => ({
          results: results.filter((result) => result.verifyRunId === run.id),
          run,
        })),
      );
      return [
        id,
        {
          checks: checks.map((check) => ({
            passed: check.state === 'passed',
            state: check.state,
            summary: check.result?.toulmin?.reasoning ?? null,
            title: check.title,
          })),
          status,
        },
      ];
    },
    { concurrency: ACCEPTANCE_READ_CONCURRENCY },
  );

  return { acceptances: Object.fromEntries(entries), nodeAcceptanceIds };
};
