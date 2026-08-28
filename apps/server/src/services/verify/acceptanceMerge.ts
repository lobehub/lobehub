import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';
import { count, eq } from 'drizzle-orm';

import { AcceptanceModel } from '@/database/models/acceptance';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type {
  AcceptanceItem,
  VerifyCheckResultItem,
  VerifyRunItem,
} from '@/database/schemas/verify';
import { verifyRuns } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:verify-acceptance-merge');

/** What a merge moved — surfaced to the caller so the UI can report it. */
export interface AcceptanceMergeSummary {
  /** Distinct check items carried over from the source. */
  movedChecks: number;
  /** Verification rounds re-chained onto the target. */
  movedRounds: number;
  /** How many of those checks had to be re-keyed to avoid a target collision. */
  rekeyedChecks: number;
}

/**
 * Every check id a round chain speaks — plan item ids, the logical ids they
 * resolve to (`sourceCriterionId`), and the ids results are keyed by (an
 * ingested result may name an item no plan carries).
 *
 * The union view aligns checks across rounds by these ids, so they are exactly
 * what must not collide when two chains are merged into one.
 */
export const collectCheckIds = (
  runs: Pick<VerifyRunItem, 'plan'>[],
  results: Pick<VerifyCheckResultItem, 'checkItemId'>[],
): Set<string> => {
  const ids = new Set<string>();
  for (const run of runs) {
    for (const item of (run.plan ?? []) as VerifyCheckItem[]) {
      ids.add(item.id);
      if (item.sourceCriterionId) ids.add(item.sourceCriterionId);
    }
  }
  for (const result of results) ids.add(result.checkItemId);
  return ids;
};

/**
 * How many CHECKS the source chain holds, as the acceptance union counts rows.
 *
 * Deliberately not `collectCheckIds().size`: that set is the collision domain,
 * where one generated check contributes BOTH its plan-item id and the
 * `sourceCriterionId` it resolves to. Counting it would report a single check
 * twice — and this number is what the user is told moved ("N 项验收项").
 *
 * So it counts the same way the union builds rows: logical ids, with the
 * generations folded away by `supersedes` removed (they render inside their
 * successor's timeline, not as rows of their own).
 */
export const countLogicalChecks = (
  runs: Pick<VerifyRunItem, 'plan'>[],
  results: Pick<VerifyCheckResultItem, 'checkItemId'>[],
): number => {
  const logical = new Set<string>();
  const superseded = new Set<string>();
  const logicalByItemId = new Map<string, string>();

  for (const run of runs) {
    for (const item of (run.plan ?? []) as VerifyCheckItem[]) {
      const id = item.sourceCriterionId ?? item.id;
      logicalByItemId.set(item.id, id);
      logical.add(id);
      for (const replaced of item.supersedes ?? []) superseded.add(replaced);
    }
  }
  // A result may name an item no plan carries (a direct ingest).
  for (const result of results) {
    logical.add(logicalByItemId.get(result.checkItemId) ?? result.checkItemId);
  }
  for (const id of superseded) logical.delete(id);

  return logical.size;
};

/**
 * Assign a fresh id to every source check id the target already uses.
 *
 * Check ids are harness-authored strings (`case-1`, a slug, a uuid), so two
 * independently produced chains routinely share them. Left alone, the union
 * would read the source's `case-1` as a LATER ROUND of the target's `case-1` —
 * silently overwriting an unrelated check's verdict and evidence. Re-keying the
 * colliding ids is what keeps the two checks two rows.
 *
 * Only collisions are re-keyed: a source id the target never used keeps its
 * wording, so shared criterion ids (`sourceCriterionId`) still align on purpose.
 */
export const planCheckIdRemap = (
  sourceIds: Iterable<string>,
  takenIds: Set<string>,
  /** Stable, human-recognizable suffix — the source aggregate's short id. */
  salt: string,
): Map<string, string> => {
  const remap = new Map<string, string>();
  // Every id in play, so a generated replacement can't collide with a source id
  // that has not been visited yet either.
  const used = new Set([...takenIds, ...sourceIds]);

  for (const id of sourceIds) {
    if (!takenIds.has(id)) continue;
    let candidate = `${id}~${salt}`;
    let attempt = 2;
    while (used.has(candidate)) {
      candidate = `${id}~${salt}-${attempt}`;
      attempt += 1;
    }
    used.add(candidate);
    remap.set(id, candidate);
  }

  return remap;
};

/** Rewrite a plan item's own id and every id it references. */
export const remapPlanItem = (
  item: VerifyCheckItem,
  remap: Map<string, string>,
): VerifyCheckItem => {
  const next: VerifyCheckItem = { ...item, id: remap.get(item.id) ?? item.id };
  if (item.sourceCriterionId) {
    next.sourceCriterionId = remap.get(item.sourceCriterionId) ?? item.sourceCriterionId;
  }
  // `supersedes` folds an older generation into this row — the reference has to
  // follow the rename or the fold silently stops matching.
  if (item.supersedes?.length) {
    next.supersedes = item.supersedes.map((id) => remap.get(id) ?? id);
  }
  return next;
};

interface MergeRoundsParams {
  db: LobeChatDatabase;
  source: AcceptanceItem;
  target: AcceptanceItem;
  userId: string;
  workspaceId?: string;
}

/**
 * Move the source aggregate's whole round chain onto the target, then drop the
 * (now empty) source.
 *
 * Rounds are re-chained rather than copied: a check item's verdict, evidence,
 * per-check user decisions and round report all hang off the run, so moving the
 * run carries the entire acceptance ledger with it — nothing is duplicated and
 * no id in the evidence graph changes. Source rounds are appended AFTER the
 * target's existing ones, in their own order, so the target's check numbering
 * (`C3`, which feedback references) never shifts.
 */
export const mergeAcceptanceRounds = async ({
  db,
  source,
  target,
  userId,
  workspaceId,
}: MergeRoundsParams): Promise<AcceptanceMergeSummary> => {
  const runModel = new VerifyRunModel(db, userId, workspaceId);
  const resultModel = new VerifyCheckResultModel(db, userId, workspaceId);

  const [sourceRuns, targetRuns] = await Promise.all([
    runModel.listByAcceptance(source.id),
    runModel.listByAcceptance(target.id),
  ]);
  const [sourceResults, targetResults] = await Promise.all([
    resultModel.listByRuns(sourceRuns.map((run) => run.id)),
    resultModel.listByRuns(targetRuns.map((run) => run.id)),
  ]);

  const sourceIds = collectCheckIds(sourceRuns, sourceResults);
  const movedChecks = countLogicalChecks(sourceRuns, sourceResults);
  const remap = planCheckIdRemap(
    sourceIds,
    collectCheckIds(targetRuns, targetResults),
    source.id.slice(0, 8),
  );

  await db.transaction(async (tx) => {
    const txRunModel = new VerifyRunModel(tx, userId, workspaceId);
    const txResultModel = new VerifyCheckResultModel(tx, userId, workspaceId);

    if (remap.size > 0) {
      await Promise.all(
        sourceRuns
          .filter((run) => run.plan?.length)
          .map((run) =>
            txRunModel.update(run.id, {
              plan: (run.plan as VerifyCheckItem[]).map((item) => remapPlanItem(item, remap)),
            }),
          ),
      );
      await Promise.all(
        sourceResults
          .filter((result) => remap.has(result.checkItemId))
          .map((result) =>
            txResultModel.update(result.id, { checkItemId: remap.get(result.checkItemId)! }),
          ),
      );
    }

    // Sequentially: each attach reads the target chain's current max round
    // index, so the source rounds land in their own order behind the target's.
    for (const run of sourceRuns) {
      await txRunModel.attachToAcceptance(run.id, target.id, target.visibility);
    }

    // The standing checklist (the topic tray) lives on the aggregate, not on a
    // round — so it is carried over by hand. Deduped by name: the two lists
    // routinely describe the same delivery from two conversations.
    const targetChecklist = target.config?.checklist ?? [];
    const seenNames = new Set(targetChecklist.map((entry) => entry.name.trim().toLowerCase()));
    const carried = (source.config?.checklist ?? []).filter(
      (entry) => !seenNames.has(entry.name.trim().toLowerCase()),
    );

    // Ownership-scoped reads drive the move, so a round the caller cannot see
    // (a workspace member's private run chained by an owner) would stay behind
    // and be silently detached by the delete below. Count unscoped: if anything
    // is still chained, abort the whole merge rather than orphan a round.
    const [{ value: leftBehind }] = await tx
      .select({ value: count() })
      .from(verifyRuns)
      .where(eq(verifyRuns.acceptanceId, source.id));
    if (leftBehind > 0) {
      throw new Error(
        `Cannot merge: ${leftBehind} verification round(s) of this acceptance are not visible to you`,
      );
    }

    const txAcceptanceModel = new AcceptanceModel(tx, userId, workspaceId);

    if (carried.length > 0 || (!target.requirement && source.requirement)) {
      await txAcceptanceModel.update(target.id, {
        ...(carried.length > 0
          ? { config: { ...target.config, checklist: [...targetChecklist, ...carried] } }
          : {}),
        // A target that never recorded a goal adopts the source's, instead of
        // reading "尚未记录该对象的验收目标" after absorbing its checks.
        ...(!target.requirement && source.requirement ? { requirement: source.requirement } : {}),
      });
    }

    // The source is empty now — its rounds, results and evidence all live on the
    // target. Deleting it is what makes the merge one entry instead of two.
    await txAcceptanceModel.delete(source.id);
  });

  log(
    'merged acceptance %s into %s: %d round(s), %d check(s), %d re-keyed',
    source.id,
    target.id,
    sourceRuns.length,
    movedChecks,
    remap.size,
  );

  return {
    movedChecks,
    movedRounds: sourceRuns.length,
    rekeyedChecks: remap.size,
  };
};
