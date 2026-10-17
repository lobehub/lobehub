import type { VerifyCheckItem } from '@lobechat/types';

import type { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyRunItem } from '@/database/schemas/verify';

/** Guard against a cyclic or runaway repair chain; real chains stop at the repair cap. */
const MAX_HOPS = 20;

/**
 * Follow a check item from the round a caller named to the round that will
 * actually judge it. Once a round's failure spawns a repair, its result row
 * records `repairOperationId` and that repair owns the next round; the
 * superseded round is settled and never re-judged. A repair agent that reuses
 * the round id from its feedback would otherwise attach the evidence it was
 * asked for to the old round, leaving the new round's structural gate to fail
 * on the same missing artifact, one round behind, every time.
 *
 * Returns the input run when the item was never repaired, or when the successor
 * round is missing or no longer plans the item.
 */
export const resolveLiveRoundForItem = async (
  models: { resultModel: VerifyCheckResultModel; runModel: VerifyRunModel },
  run: VerifyRunItem,
  checkItemId: string,
): Promise<VerifyRunItem> => {
  let current = run;
  const seen = new Set([run.id]);

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const results = await models.resultModel.listByRun(current.id);
    const repairOperationId = results.find(
      (result) => result.checkItemId === checkItemId,
    )?.repairOperationId;
    if (!repairOperationId) return current;

    const next = await models.runModel.findByOperation(repairOperationId);
    if (!next || seen.has(next.id)) return current;
    const plan = (next.plan as VerifyCheckItem[] | null) ?? [];
    if (!plan.some((item) => item.id === checkItemId)) return current;

    seen.add(next.id);
    current = next;
  }

  return current;
};
