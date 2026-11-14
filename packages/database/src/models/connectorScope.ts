import { and, eq, exists, sql } from 'drizzle-orm';

import { agentEvalDatasets, userConnectors } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/** Shared by connection rows and their tool rows; default access is ordinary-only. */
export const connectorAccessScope = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  datasetId?: string,
) =>
  and(
    buildWorkspaceWhere(scope, userConnectors),
    datasetId
      ? and(
          sql`${userConnectors.metadata} -> 'agentEval' ->> 'datasetId' = ${datasetId}`,
          exists(
            db
              .select({ id: agentEvalDatasets.id })
              .from(agentEvalDatasets)
              .where(
                and(
                  eq(agentEvalDatasets.id, datasetId),
                  buildWorkspaceWhere(scope, agentEvalDatasets),
                ),
              ),
          ),
        )
      : sql`COALESCE(${userConnectors.metadata} ->> 'agentEval', '') = ''`,
  );
