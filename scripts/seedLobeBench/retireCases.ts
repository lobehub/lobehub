import { and, inArray, isNull, sql } from 'drizzle-orm';

import { agentEvalTestCases } from '../../packages/database/src/schemas';
import type { Transaction } from '../../packages/database/src/type';

/** Preserve referenced rows and run results when an ordinary seed drops a case. */
export const retireLobeBenchCases = async (tx: Pick<Transaction, 'update'>, caseIds: string[]) => {
  if (!caseIds.length) return;
  await tx
    .update(agentEvalTestCases)
    .set({
      metadata: sql`COALESCE(${agentEvalTestCases.metadata}, '{}'::jsonb) || '{"retired":true}'::jsonb`,
      updatedAt: new Date(),
    })
    .where(and(inArray(agentEvalTestCases.id, caseIds), isNull(agentEvalTestCases.userId)));
};
