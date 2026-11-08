import { TRACING_SCENARIOS } from '@lobechat/const';
import { DISPUTE_SETTLED_RUN_STATUSES, HOLISTIC_CHECK_TITLE } from '@lobechat/const/verify';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainVerifyDisputeArbitration,
  DISPUTE_RULING_JSON_SCHEMA,
  VERIFY_DISPUTE_PROMPT_VERSION,
} from '@lobechat/prompts';
import type {
  VerifyCheckDispute,
  VerifyCheckDisputeKind,
  VerifyCheckItem,
  VerifyCheckResultMetadata,
  VerifyDisputeArbitration,
  VerifyDisputeVote,
} from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import { AcceptanceModel } from '@/database/models/acceptance';
import { DocumentModel } from '@/database/models/document';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveCheckInstruction } from './checkInstruction';
import { DISPUTE_PANEL_SIZE, resolveDisputePanelModelConfigs } from './goalReviewModelConfig';
import type { VerifyModelConfig } from './modelConfig';

const log = debug('lobe-server:verify-dispute');

/** Long enough for a real argument, short enough to stay a claim and not a document. */
export const MAX_DISPUTE_REASON_CHARS = 2000;

const DisputeRulingSchema = z.object({ reason: z.string().nullish(), upheld: z.boolean() });

export type FileCheckDisputeError =
  | 'ALREADY_RULED'
  | 'ARBITRATION_IN_PROGRESS'
  | 'EMPTY_REASON'
  | 'HOLISTIC_CHECK'
  | 'NO_VERIFY_RUN'
  | 'PANEL_UNAVAILABLE'
  | 'ROUND_SETTLED'
  | 'UNKNOWN_CRITERION'
  | 'UNKNOWN_EVIDENCE';

export type FileCheckDisputeResult =
  | { dispute: VerifyCheckDispute; message: string; success: true }
  | { error: FileCheckDisputeError; message: string; success: false };

export interface FileCheckDisputeParams {
  checkItemId: string;
  evidenceIds?: string[];
  kind: VerifyCheckDisputeKind;
  reason: string;
  /** The Agent Run whose verify round holds the check. */
  runOperationId: string;
  /** Lets the panel fall back to the task's own model when a pinned member is unavailable. */
  taskId?: string;
}

/**
 * The same check across the rounds of one Acceptance, keyed exactly as the
 * acceptance check union keys it: a flow node's check is its own occurrence
 * even when several nodes reuse one criterion asset, so it keeps its item id; a
 * criterion keeps its `sourceCriterionId` from round to round while its item id
 * is minted fresh. A check with neither keeps its own item id — two such checks
 * can share a title and must never share a ruling.
 */
const logicalCheckKey = (item: {
  id: string;
  sourceCriterionId?: string | null;
  sourceFlowNode?: unknown;
}) =>
  !item.sourceFlowNode && item.sourceCriterionId
    ? `criterion:${item.sourceCriterionId}`
    : `item:${item.id}`;

/**
 * A judged or decided round: a dispute can no longer change it. The guarded
 * write re-checks this atomically, for a round that settles mid-arbitration.
 */
const isRoundSettled = (run: { status?: string | null; userDecision?: string | null }) =>
  !!run.userDecision ||
  (DISPUTE_SETTLED_RUN_STATUSES as readonly string[]).includes(run.status ?? '');

const ROUND_SETTLED: FileCheckDisputeResult = {
  error: 'ROUND_SETTLED',
  message:
    'This round has already been judged, so a dispute can no longer change it. File disputes while the run is still working; for a settled round, make the argument in your handoff.',
  success: false,
};

/** An arbitration that has held its claim this long died; a new filing may take over. */
const ARBITRATION_CLAIM_TTL_MS = 5 * 60 * 1000;

const readDispute = (metadata: unknown): VerifyCheckDispute | undefined =>
  (metadata as VerifyCheckResultMetadata | null | undefined)?.dispute;

/**
 * Ask every panel member at once, then count. Each member gets one retry, which
 * absorbs a dropped connection without letting a nondeterministic second call
 * replace a ruling that already landed.
 */
const runArbitrationPanel = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  panel: VerifyModelConfig[],
  chain: ReturnType<typeof chainVerifyDisputeArbitration>,
): Promise<VerifyDisputeArbitration> => {
  const ai = new AiGenerationService(db, userId, workspaceId);
  const ask = async (member: VerifyModelConfig): Promise<VerifyDisputeVote> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await ai.generateObject(
          { ...chain, ...member, schema: DISPUTE_RULING_JSON_SCHEMA },
          {
            metadata: { trigger: RequestTrigger.Verify },
            tracing: {
              promptVersion: VERIFY_DISPUTE_PROMPT_VERSION,
              scenario: TRACING_SCENARIOS.VerifyDisputeArbitration,
              schemaName: DISPUTE_RULING_JSON_SCHEMA.name,
            } satisfies TracingOptions,
          },
        );
        const parsed = DisputeRulingSchema.safeParse(raw);
        if (parsed.success) {
          return {
            ...member,
            reason: parsed.data.reason ?? undefined,
            status: 'judged',
            upheld: parsed.data.upheld,
          };
        }
        log('panel member %s/%s returned an unparseable ruling', member.provider, member.model);
      } catch (error) {
        log('panel member %s/%s failed: %O', member.provider, member.model, error);
      }
    }
    return { ...member, status: 'errored' };
  };

  const votes = await pMap(panel, ask, { concurrency: DISPUTE_PANEL_SIZE });
  const majority = Math.floor(DISPUTE_PANEL_SIZE / 2) + 1;
  const upheld = votes.filter((vote) => vote.upheld === true).length;
  const overruled = votes.filter((vote) => vote.upheld === false).length;
  return {
    decidedAt: new Date().toISOString(),
    outcome: upheld >= majority ? 'upheld' : overruled >= majority ? 'overruled' : 'undecided',
    votes,
  };
};

const describeArbitration = (title: string, arbitration: VerifyDisputeArbitration) => {
  const judged = arbitration.votes.filter((vote) => vote.status === 'judged');
  const tally = `${judged.filter((vote) => vote.upheld).length} of ${arbitration.votes.length} panel models upheld it`;
  switch (arbitration.outcome) {
    case 'upheld': {
      return `Dispute upheld (${tally}). "${title}" is waived for this delivery: it no longer counts against it, and you do not need to satisfy it.`;
    }
    case 'overruled': {
      const reasons = judged
        .filter((vote) => vote.upheld === false && vote.reason)
        .map((vote) => `- ${vote.reason}`);
      return [
        `Dispute overruled (${tally}). "${title}" stands: satisfy it and submit evidence for it. This check cannot be disputed again.`,
        ...(reasons.length ? ['Why:', ...reasons] : []),
      ].join('\n');
    }
    default: {
      return `The panel reached no majority (${tally}), so "${title}" stands for now. Satisfy it if you can; you may file the dispute again.`;
    }
  }
};

/**
 * File a builder's dispute of one check in its Agent Run's verify round.
 *
 * - `missed_evidence` records the builder's note; the Goal review of the
 *   delivery reads it as the builder's rebuttal next to the evidence. The
 *   completion verifier and the review prediction do not consume it yet, so the
 *   note is only advertised as far as it is read. It changes no verdict by itself.
 * - `invalid_criterion` is arbitrated right away by a panel of three models and
 *   the majority rules. Upheld waives the check (see `isCheckWaivedByDispute`);
 *   overruled is final for that check across the Acceptance, so a builder cannot
 *   re-roll a panel it lost. A ruling upheld in an earlier round carries over to
 *   a later round's check for free.
 */
export const fileCheckDispute = async (
  db: LobeChatDatabase,
  userId: string,
  params: FileCheckDisputeParams,
  workspaceId?: string,
): Promise<FileCheckDisputeResult> => {
  const reason = params.reason.trim().slice(0, MAX_DISPUTE_REASON_CHARS);
  if (!reason) {
    return {
      error: 'EMPTY_REASON',
      message: 'Explain why the check is wrong or where the evidence already proves it.',
      success: false,
    };
  }

  const runModel = new VerifyRunModel(db, userId, workspaceId);
  const run = await runModel.findByOperation(params.runOperationId);
  if (!run) {
    return {
      error: 'NO_VERIFY_RUN',
      message: 'This run has no Acceptance round to dispute.',
      success: false,
    };
  }
  if (isRoundSettled(run)) return ROUND_SETTLED;
  const plan = (run.plan ?? []) as VerifyCheckItem[];
  const item = plan.find((candidate) => candidate.id === params.checkItemId);
  if (!item) {
    return {
      error: 'UNKNOWN_CRITERION',
      message: `No check "${params.checkItemId}" in this round. Use an id from the current criteria list.`,
      success: false,
    };
  }
  if (params.kind === 'invalid_criterion' && item.title === HOLISTIC_CHECK_TITLE) {
    return {
      error: 'HOLISTIC_CHECK',
      message:
        'The whole-delivery check restates the requirement itself, so it cannot be waived. Dispute a specific check instead.',
      success: false,
    };
  }

  const resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
  const result = await resultModel.upsertByCheckItem({
    checkItemId: item.id,
    checkItemIndex: item.index,
    checkItemTitle: item.title,
    operationId: params.runOperationId,
    required: item.required,
    verifierType: item.verifierType,
    verifyRunId: run.id,
  });

  const evidenceIds = [...new Set(params.evidenceIds ?? [])];
  if (evidenceIds.length > 0) {
    const onCheck = new Set(
      (await new VerifyEvidenceModel(db, userId, workspaceId).listByCheckResult(result.id)).map(
        (row) => row.id,
      ),
    );
    const unknown = evidenceIds.find((id) => !onCheck.has(id));
    if (unknown) {
      return {
        error: 'UNKNOWN_EVIDENCE',
        message: `Evidence ${unknown} is not attached to "${item.title}" in this round. Submit it for this check first, then point at it.`,
        success: false,
      };
    }
  }

  // Every write is guarded: it lands only while no ruling is decided on this
  // result and no other arbitration holds it, so concurrent filings cannot
  // overwrite a ruling or each other.
  const write = (dispute: VerifyCheckDispute, holder?: string) =>
    resultModel.writeDisputeIfOpen(result.id, dispute as unknown as Record<string, unknown>, {
      holder,
      staleBefore: new Date(Date.now() - ARBITRATION_CLAIM_TTL_MS),
    });
  // Read back what blocked a refused write, and answer with it.
  const refused = async (): Promise<FileCheckDisputeResult> => {
    const latestRun = await runModel.findById(run.id);
    if (!latestRun || isRoundSettled(latestRun)) return ROUND_SETTLED;
    const latest = readDispute((await resultModel.findById(result.id))?.metadata);
    const ruling = latest?.arbitration;
    if (latest?.kind === 'invalid_criterion' && ruling && ruling.outcome !== 'undecided') {
      return params.kind === 'invalid_criterion'
        ? { dispute: latest, message: describeArbitration(item.title, ruling), success: true }
        : {
            error: 'ALREADY_RULED',
            message: `A panel already ruled on "${item.title}" in this round (${ruling.outcome}). Make the evidence argument in your handoff instead.`,
            success: false,
          };
    }
    return {
      error: 'ARBITRATION_IN_PROGRESS',
      message: `A panel is already ruling on "${item.title}". File the same dispute again in a minute to read its ruling.`,
      success: false,
    };
  };
  const filed: VerifyCheckDispute = {
    ...(evidenceIds.length ? { evidenceIds } : {}),
    filedAt: new Date().toISOString(),
    kind: params.kind,
    reason,
  };

  if (params.kind === 'missed_evidence') {
    if (!(await write(filed))) return refused();
    return {
      dispute: filed,
      message: `Recorded for "${item.title}". The Goal review of this delivery reads your note next to the check's evidence; other automated reviews do not read it yet, and the note alone does not pass the check.`,
      success: true,
    };
  }

  // A ruling is per check, not per round: answer this round's own ruling
  // again, then look for the check's rulings in earlier rounds.
  const current = readDispute(result.metadata);
  if (
    current?.kind === 'invalid_criterion' &&
    current.arbitration &&
    current.arbitration.outcome !== 'undecided'
  ) {
    return {
      dispute: current,
      message: describeArbitration(item.title, current.arbitration),
      success: true,
    };
  }
  if (run.acceptanceId) {
    const rounds = await runModel.listByAcceptance(run.acceptanceId);
    const planItems = new Map(
      rounds.flatMap((round) =>
        ((round.plan ?? []) as VerifyCheckItem[]).map(
          (planned) => [`${round.id}:${planned.id}`, planned] as const,
        ),
      ),
    );
    const key = logicalCheckKey(item);
    const earlier = (await resultModel.listByRuns(rounds.map((round) => round.id)))
      .filter((row: VerifyCheckResultItem) => {
        if (row.id === result.id) return false;
        const planned = planItems.get(`${row.verifyRunId}:${row.checkItemId}`);
        return (
          logicalCheckKey(
            planned ?? { id: row.checkItemId, sourceCriterionId: row.sourceCriterionId },
          ) === key
        );
      })
      .map((row) => readDispute(row.metadata)?.arbitration)
      .filter((ruling): ruling is VerifyDisputeArbitration => !!ruling);
    if (earlier.some((ruling) => ruling.outcome === 'overruled')) {
      return {
        error: 'ALREADY_RULED',
        message: `A panel already overruled a dispute of "${item.title}". The check stands: satisfy it.`,
        success: false,
      };
    }
    const upheld = earlier.find((ruling) => ruling.outcome === 'upheld');
    if (upheld) {
      const dispute = { ...filed, arbitration: upheld };
      if (!(await write(dispute))) return refused();
      return { dispute, message: describeArbitration(item.title, upheld), success: true };
    }
  }

  // Claim the check before paying for a panel: a concurrent filing that loses
  // the claim gets the in-progress answer instead of rolling its own panel.
  const claim = new Date().toISOString();
  if (!(await write({ ...filed, arbitratingSince: claim }))) return refused();

  const acceptance = run.acceptanceId
    ? await new AcceptanceModel(db, userId, workspaceId).findById(run.acceptanceId)
    : undefined;
  const panel = await resolveDisputePanelModelConfigs(
    db,
    userId,
    { taskId: params.taskId, verifierAgentId: acceptance?.config?.verifierAgentId },
    workspaceId,
  );
  if (panel.length < DISPUTE_PANEL_SIZE) {
    // Release the claim without a ruling: the dispute can be filed again once
    // models are available.
    if (!(await write(filed, claim))) return refused();
    return {
      error: 'PANEL_UNAVAILABLE',
      message: `Only ${panel.length} of the ${DISPUTE_PANEL_SIZE} review providers a ruling needs are available, so the dispute was recorded but not arbitrated and "${item.title}" stands. Say so in your handoff so the owner can decide.`,
      success: false,
    };
  }

  // The frozen contract the verifier enforced, never the live document alone.
  const instruction = await resolveCheckInstruction(
    new DocumentModel(db, userId, workspaceId),
    item,
  );
  const arbitration = await runArbitrationPanel(
    db,
    userId,
    workspaceId,
    panel,
    chainVerifyDisputeArbitration({
      builderReason: reason,
      instruction,
      otherChecks: plan.filter((other) => other.id !== item.id).map((other) => other.title),
      requirement: acceptance?.requirement ?? undefined,
      title: item.title,
    }),
  );
  log('dispute of %s in run %s → %s', item.id, run.id, arbitration.outcome);
  const dispute = { ...filed, arbitration };
  // Only the claim holder writes the ruling; a takeover after a stale claim wins.
  if (!(await write(dispute, claim))) return refused();
  return { dispute, message: describeArbitration(item.title, arbitration), success: true };
};
