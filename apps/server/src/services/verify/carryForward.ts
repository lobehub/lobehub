import type { VerifyCheckItem } from '@lobechat/types';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

/** Where a carried result came from, stored under `metadata.carriedFrom`. */
export interface CarriedFromMetadata {
  checkResultId: string;
  roundIndex: number | null;
  verifyRunId: string;
}

const EVIDENCE_CARRY_KEY = 'carriedFromEvidenceId';

export const readCarriedFrom = (
  result: Pick<VerifyCheckResultItem, 'metadata'>,
): CarriedFromMetadata | undefined =>
  (result.metadata as { carriedFrom?: CarriedFromMetadata } | null)?.carriedFrom;

const isCarriedEvidence = (row: { metadata?: unknown }): boolean =>
  Boolean((row.metadata as Record<string, unknown> | null)?.[EVIDENCE_CARRY_KEY]);

/**
 * A repair round re-runs the checks it was asked to fix; the checks that
 * already passed are not its job. They used to be planned, gated and judged
 * again anyway, with only what the repair turn happened to capture — which is
 * evidence for the failed checks — so a passing check landed at the structural
 * gate with nothing, or in front of a verifier reading "no code changed this
 * round", and the round failed on work an earlier round had already proven.
 * Each repair then broke a different check, and the loop ran until its budget.
 *
 * Copy every passed result of the source round, with its evidence, into the
 * repair round instead. The repair round still holds a complete, judged
 * checklist, so its rollup, the acceptance union and the Goal review all read
 * real evidence for every check.
 */
export const carryPassedResultsForward = async (
  db: LobeChatDatabase,
  userId: string,
  params: {
    excludeItemIds?: Iterable<string>;
    operationId: string;
    plan: VerifyCheckItem[];
    sourceRoundIndex?: number | null;
    sourceRunId: string;
    targetRunId: string;
  },
  workspaceId?: string,
): Promise<string[]> => {
  const resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
  const evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
  const excluded = new Set(params.excludeItemIds);
  const planned = new Map(params.plan.map((item) => [item.id, item]));

  const sourceResults = await resultModel.listByRun(params.sourceRunId);
  const carried: string[] = [];
  for (const source of sourceResults) {
    const item = planned.get(source.checkItemId);
    if (!item || excluded.has(item.id)) continue;
    if (source.status !== 'passed' || source.verdict !== 'passed') continue;
    if (source.userDecision === 'rejected') continue;

    const carriedFrom: CarriedFromMetadata = {
      checkResultId: source.id,
      roundIndex: params.sourceRoundIndex ?? null,
      verifyRunId: params.sourceRunId,
    };
    const result = await resultModel.upsertByCheckItem({
      checkItemId: item.id,
      checkItemIndex: item.index,
      checkItemTitle: item.title,
      completedAt: new Date(),
      confidence: source.confidence,
      metadata: { ...source.metadata, carriedFrom },
      operationId: params.operationId,
      required: item.required,
      startedAt: source.startedAt,
      status: 'passed',
      toulmin: {
        ...source.toulmin,
        limitation: [
          source.toulmin?.limitation,
          `Carried forward from round ${params.sourceRoundIndex ?? '?'}: this repair round was not asked to change it.`,
        ]
          .filter(Boolean)
          .join(' '),
      },
      verdict: 'passed',
      verifierType: item.verifierType,
      verifyRunId: params.targetRunId,
    });

    const evidence = await evidenceModel.listByCheckResult(source.id);
    await evidenceModel.createMany(
      evidence.map(({ id, createdAt: _createdAt, ...row }) => ({
        ...row,
        checkResultId: result.id,
        metadata: {
          ...(row.metadata as Record<string, unknown> | null),
          [EVIDENCE_CARRY_KEY]: id,
        },
      })),
    );
    carried.push(item.id);
  }
  return carried;
};

/**
 * The carried results the executor should leave alone: still passed, and
 * backed only by the evidence copied from the earlier round. A carried check
 * the builder evidenced again in this round is judged again — the new artifact
 * may show a regression the copied verdict cannot know about.
 */
export const settledCarriedItemIds = (
  results: Pick<VerifyCheckResultItem, 'checkItemId' | 'metadata' | 'status'>[],
  evidence: { checkItemId: string; metadata?: unknown }[],
): { reopened: string[]; settled: Set<string> } => {
  const fresh = new Set(
    evidence.filter((row) => !isCarriedEvidence(row)).map((row) => row.checkItemId),
  );
  const settled = new Set<string>();
  const reopened: string[] = [];
  for (const result of results) {
    if (!readCarriedFrom(result)) continue;
    if (result.status === 'passed' && !fresh.has(result.checkItemId)) {
      settled.add(result.checkItemId);
    } else reopened.push(result.checkItemId);
  }
  return { reopened, settled };
};
