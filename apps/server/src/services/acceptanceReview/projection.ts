import type {
  AcceptanceReviewMarkResult,
  AcceptanceReviewMarkVerdict,
  AcceptanceReviewPhase,
} from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';

import type { AcceptanceReviewMarkRow, AcceptanceReviewRow } from '@/database/schemas';
import { acceptances, tasks, verifyEvidence } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { AcceptanceService, buildAcceptanceCheckUnion } from '@/server/services/verify';
import { createEvidenceFileResolver } from '@/server/services/verify/evidenceFiles';

export interface MarkCheck {
  checkId: string;
  result: AcceptanceReviewMarkResult;
}

export interface ReviewProjectionResult {
  checks: Map<string, MarkCheck>;
  counts: { agentPassed: number; humanPassed: number };
  deliveryStatus: string | null;
  phase: AcceptanceReviewPhase;
  reportUrl: string | null;
  results: Map<string, AcceptanceReviewMarkResult>;
  task: { id: string; identifier: string | null } | null;
}

const phaseOf = (status: string | undefined): AcceptanceReviewPhase => {
  if (status === 'accepted') return 'accepted';
  if (status === 'closed') return 'closed';
  if (status === 'delivered') return 'delivered';
  return 'running';
};

const agentVerdict = (verdict: string | null) =>
  verdict === 'passed' ? 'pass' : verdict === 'failed' ? 'fail' : 'uncertain';

const humanVerdict = (decision: string | null | undefined): AcceptanceReviewMarkVerdict | null =>
  decision === 'accepted' || decision === 'overridden'
    ? 'pass'
    : decision === 'rejected'
      ? 'not_fixed'
      : null;

const emptyProjection = (phase: AcceptanceReviewPhase): ReviewProjectionResult => ({
  checks: new Map(),
  counts: { agentPassed: 0, humanPassed: 0 },
  deliveryStatus: null,
  phase,
  reportUrl: null,
  results: new Map(),
  task: null,
});

export const projectReview = async (
  db: LobeChatDatabase,
  review: AcceptanceReviewRow,
  marks: Pick<AcceptanceReviewMarkRow, 'id'>[],
): Promise<ReviewProjectionResult> => {
  if (review.status === 'draft') return emptyProjection('draft');
  const [task] = review.taskId
    ? await db
        .select({ id: tasks.id, identifier: tasks.identifier })
        .from(tasks)
        .where(eq(tasks.id, review.taskId))
        .limit(1)
    : [];
  const delivery = review.deliveryAcceptanceId
    ? await db.query.acceptances.findFirst({
        where: eq(acceptances.id, review.deliveryAcceptanceId),
      })
    : undefined;
  if (!delivery) return { ...emptyProjection('running'), task: task ?? null };

  const service = new AcceptanceService(db, delivery.userId, delivery.workspaceId ?? undefined);
  const { results, runs } = await service.loadRounds(delivery.id);
  const union = buildAcceptanceCheckUnion(
    runs.map((run) => ({
      results: results.filter((result) => result.verifyRunId === run.id),
      run,
    })),
  );
  const latestPlan = new Set((runs.at(-1)?.plan ?? []).map((item) => item.id));
  const resultIds = union.flatMap((check) => (check.result ? [check.result.id] : []));
  const evidenceRows = resultIds.length
    ? await db
        .select({ checkResultId: verifyEvidence.checkResultId, fileId: verifyEvidence.fileId })
        .from(verifyEvidence)
        .where(inArray(verifyEvidence.checkResultId, resultIds))
    : [];
  const resolve = createEvidenceFileResolver(
    db,
    delivery.userId,
    delivery.workspaceId ?? undefined,
  );
  const evidenceByResult = new Map<string, { url: string }[]>();
  for (const row of evidenceRows) {
    const url = row.fileId ? (await resolve(row.fileId)).fileUrl : null;
    if (!url) continue;
    const list = evidenceByResult.get(row.checkResultId) ?? [];
    list.push({ url });
    evidenceByResult.set(row.checkResultId, list);
  }

  const checks = new Map<string, MarkCheck>();
  for (const check of union) {
    const markId = check.planItem?.id ?? check.id;
    const result = check.result;
    checks.set(markId, {
      checkId: check.id,
      result: {
        agent: result?.verdict
          ? {
              evidence: evidenceByResult.get(result.id) ?? [],
              summary: result.toulmin?.reasoning ?? result.toulmin?.evidence ?? undefined,
              verdict: agentVerdict(result.verdict),
            }
          : undefined,
        human: humanVerdict(result?.userDecision),
        missing: !latestPlan.has(markId),
      },
    });
  }

  const resultsByMark = new Map<string, AcceptanceReviewMarkResult>();
  let agentPassed = 0;
  let humanPassed = 0;
  for (const mark of marks) {
    const found = checks.get(mark.id);
    if (!found) continue;
    resultsByMark.set(mark.id, found.result);
    if (found.result.agent?.verdict === 'pass') agentPassed += 1;
    if (found.result.human === 'pass') humanPassed += 1;
  }

  return {
    checks,
    counts: { agentPassed, humanPassed },
    deliveryStatus: delivery.status,
    phase: phaseOf(delivery.status),
    reportUrl: `${(appEnv.APP_URL ?? '').replace(/\/$/, '')}/acceptance/${delivery.id}`,
    results: resultsByMark,
    task: task ?? null,
  };
};
