import { runEvidenceGaps } from '@lobechat/const/verify';
import type { VerifyCheckItem } from '@lobechat/types';
import pc from 'picocolors';

import type { TrpcClient } from '../../../api/client';
import { resolveServerUrl } from '../../../settings';
import { outputJson } from '../../../utils/format';
import { log } from '../../../utils/logger';
import type { EvidenceType } from '../utils';
import type { FailedReportEvidence } from './evidenceUpload';
import { storageQuotaRecovery, uploadReportEvidence } from './evidenceUpload';

interface PlanRoundCase {
  case: any;
  checkItemId: string;
}

export interface PlanRoundIngestParams {
  /** result.json `plan[]`, used only when the frozen plan is empty. */
  authoredPlan?: VerifyCheckItem[];
  /** Per-case visualization metadata — check-result metadata a plan round cannot take. */
  caseMetadata: unknown[];
  /** `cases[]` after programmatic-test screening, ids frozen. */
  cases: PlanRoundCase[];
  dir: string;
  droppedLabels: string[];
  json?: boolean | string;
  operationId: string;
  proposal: string;
  pullRequest?: { title?: unknown; url?: unknown };
  /** report.md, which a plan round does not publish: its verifier writes the report. */
  reportContent?: string;
  state: {
    verifyPlan: VerifyCheckItem[] | null;
    verifyRunId: string;
  };
}

/**
 * Publish an authored round directory INTO the verification round an Agent Run
 * already owns (a Task's plan round), instead of creating another round.
 *
 * The run is keyed by its operation id — a second run on the same operation is
 * a unique violation, and a separate round would shadow the verifier's verdicts
 * and settle the acceptance behind the repair loop. So this path:
 * - writes each case through `submitCheckEvidence`, which enforces the frozen
 *   plan and redirects to the live repair round, and attaches evidence (video
 *   chapters included) exactly as a standalone ingest does;
 * - publishes no verdicts and no report: the round's verifier judges every item
 *   and writes the report when it settles.
 */
export async function ingestIntoPlanRound(
  client: TrpcClient,
  params: PlanRoundIngestParams,
): Promise<void> {
  const frozenPlan = params.state.verifyPlan ?? [];
  const plan = frozenPlan.length > 0 ? frozenPlan : (params.authoredPlan ?? []);

  // Fail before the first write: an unknown id cannot land in a frozen plan,
  // and a half-published round is worse than none.
  if (frozenPlan.length > 0) {
    const unknown = params.cases.filter(
      ({ checkItemId }) => !frozenPlan.some((item) => item.id === checkItemId),
    );
    if (unknown.length > 0) {
      log.error(
        `case id(s) not in this run's frozen plan: ${unknown.map(({ checkItemId }) => checkItemId).join(', ')}`,
      );
      log.error(
        `  Use the plan's check item ids as cases[].id: ${frozenPlan.map((item) => `${item.id} (${item.title})`).join('; ')}`,
      );
      process.exit(1);
    }
  }
  if (params.caseMetadata.some(Boolean))
    log.warn(
      'case visualizations are not published into a plan round — attach the data as evidence instead',
    );
  if (params.reportContent?.trim())
    log.warn(
      "report.md is not published into a plan round: its verifier writes the round's report. Keep the narrative in your final response.",
    );

  let evidenceCount = 0;
  let inlined = 0;
  const seen = new Set<string>();
  const failedEvidence: (FailedReportEvidence & { checkItemId: string })[] = [];
  const missingEvidence: { checkItemId: string; types: EvidenceType[] }[] = [];
  // `submitCheckEvidence` lands a check whose failure already spawned a repair
  // on that live repair round, not on the operation's own (settled) round.
  const landedRunIds = new Set<string>();
  for (const { case: c, checkItemId } of params.cases) {
    seen.add(checkItemId);
    const observation = c.keyObservation ?? c.observation ?? c.note;
    const { checkResult } = await client.verify.submitCheckEvidence.mutate({
      checkItemId,
      operationId: params.operationId,
      toulmin: typeof observation === 'string' ? { evidence: observation } : undefined,
    });
    if (checkResult.verifyRunId) landedRunIds.add(checkResult.verifyRunId);
    const uploaded = await uploadReportEvidence(client, {
      checkResultId: checkResult.id,
      dir: params.dir,
      evidence: c.evidence,
    });
    evidenceCount += uploaded.count;
    inlined += uploaded.inlined;
    failedEvidence.push(...uploaded.failedEvidence.map((failure) => ({ ...failure, checkItemId })));
    const gaps = coverageGaps(
      plan.find((item) => item.id === checkItemId),
      [...uploaded.types],
    );
    if (gaps.length > 0) {
      missingEvidence.push({ checkItemId, types: gaps });
      log.warn(`${checkItemId}: required evidence not published: ${gaps.join(', ')}.`);
    }
  }
  const unexecuted = plan.filter((item) => !seen.has(item.id));
  for (const item of unexecuted) {
    const types = coverageGaps(item, []);
    if (types.length === 0) continue;
    missingEvidence.push({ checkItemId: item.id, types });
    log.warn(`${item.id}: no case; required evidence not published: ${types.join(', ')}.`);
  }

  const run = await resolveLandedRun(client, params.state.verifyRunId, landedRunIds);

  let proposalPosted = false;
  if (params.proposal && run?.acceptanceId) {
    try {
      await client.acceptanceComment.create.mutate({
        acceptanceId: run.acceptanceId,
        authorAgentId: process.env.LOBEHUB_AGENT_ID || undefined,
        clientId: `proposal:${run.id}`,
        content: params.proposal,
        contextRunId: run.id,
        kind: 'proposal',
      });
      proposalPosted = true;
    } catch (e) {
      log.warn(`proposal not posted to the discussion: ${String(e)}`);
    }
  }
  if (params.pullRequest?.url && run?.acceptanceId) {
    try {
      await client.acceptance.linkPullRequest.mutate({
        id: run.acceptanceId,
        title: typeof params.pullRequest.title === 'string' ? params.pullRequest.title : undefined,
        url: String(params.pullRequest.url),
      });
    } catch (e) {
      log.warn(`pull request not linked to the acceptance: ${String(e)}`);
    }
  }

  const acceptanceUrl = run?.acceptanceId
    ? new URL(`/acceptance/${encodeURIComponent(run.acceptanceId)}`, resolveServerUrl()).toString()
    : null;
  // The evidence landed, but with no acceptance there is nothing to hand off:
  // a caller reading only the status must not take this for a publication.
  const blocked = !acceptanceUrl;
  if (blocked) {
    process.exitCode = 1;
    log.warn(
      'this run is not attached to an acceptance yet — report the handoff as blocked; do not ingest a duplicate round',
    );
  }
  const recovery = failedEvidence.some((failure) => failure.reason === 'storage_quota')
    ? await storageQuotaRecovery(client)
    : undefined;
  const partial = failedEvidence.length > 0 || missingEvidence.length > 0;
  if (partial) {
    process.exitCode = 1;
    log.warn(
      'Evidence publication is incomplete. Keep the local artifacts and retry only the missing evidence.',
    );
    if (recovery) log.warn(recovery.message);
  }

  if (params.json !== undefined) {
    outputJson(
      {
        acceptanceId: run?.acceptanceId ?? null,
        acceptanceUrl,
        cases: params.cases.length,
        droppedProgrammaticChecks: params.droppedLabels,
        evidence: evidenceCount,
        failedEvidence,
        inlined,
        missingEvidence,
        mode: 'plan-round',
        operationId: params.operationId,
        planItems: plan.length,
        proposalPosted,
        publicationStatus: blocked ? 'blocked' : partial ? 'partial' : 'complete',
        recovery,
        roundIndex: run?.roundIndex ?? null,
        unexecuted: unexecuted.map((item) => item.id),
        verifyRunId: run?.id ?? params.state.verifyRunId,
      },
      typeof params.json === 'string' ? params.json : undefined,
    );
    return;
  }

  console.log(
    `${blocked ? pc.yellow('⚠ Published without an acceptance') : partial ? pc.yellow('⚠ Partially published') : pc.green('✓ Published')} ${pc.bold(String(params.cases.length))} case(s), ${pc.bold(String(evidenceCount))} evidence artifact(s) into the plan round of ${pc.bold(params.operationId)}`,
  );
  for (const failure of failedEvidence) {
    console.log(`${pc.yellow('retry (POSIX shell)')}: ${failure.retryCommand}`);
  }
  if (unexecuted.length > 0)
    console.log(pc.yellow(`plan: ${unexecuted.length} item(s) without a case`));
  if (proposalPosted) console.log(`${pc.bold('proposal')}: posted to the discussion`);
  console.log(
    `${pc.bold('verifyRunId')}: ${run?.id ?? params.state.verifyRunId} ${pc.dim('(judged by its verifier)')}`,
  );
  if (acceptanceUrl) console.log(`${pc.bold('open acceptance')}: ${acceptanceUrl}`);
}

/**
 * The verifier's own gate: only `run_evidence` must exist as rows (deliverable
 * and task artifacts are resolved by the verifier), and a same-medium artifact
 * (`video` for `gif`, `markdown` for `text`) covers the requirement.
 */
const coverageGaps = (item: VerifyCheckItem | undefined, published: EvidenceType[]) =>
  runEvidenceGaps(
    item?.verifierConfig as Record<string, unknown> | undefined,
    published.map((type) => ({ type })),
  ) as EvidenceType[];

/**
 * The round this publication actually landed on, so the proposal, the links and
 * the JSON output name the round the reviewer will see. Evidence redirected to a
 * repair round makes that round the live one; when cases split across rounds,
 * the newest round is the one still being judged.
 */
const resolveLandedRun = async (
  client: TrpcClient,
  operationRunId: string,
  landedRunIds: Set<string>,
) => {
  const ids = landedRunIds.size > 0 ? [...landedRunIds] : [operationRunId];
  const runs = await Promise.all(
    ids.map((verifyRunId) => client.verify.getRun.query({ verifyRunId })),
  );
  return runs
    .filter((run): run is NonNullable<typeof run> => Boolean(run))
    .reduce<(typeof runs)[number] | undefined>(
      (latest, run) => (!latest || (run.roundIndex ?? 0) > (latest.roundIndex ?? 0) ? run : latest),
      undefined,
    );
};
