import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type {
  ToulminVerdict,
  VerifyCheckItem,
  VerifyCheckResultStatus,
  VerifyVerdict,
} from '@lobechat/types';
import debug from 'debug';

import { DocumentModel } from '@/database/models/document';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyEvidenceModel } from '@/database/models/verifyEvidence';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { coverageGaps, readRequiredEvidence } from './evidenceCoverage';
import { buildJudgePrompt, type JudgeEvidence, VERIFY_JUDGE_PROMPT_VERSION } from './prompts';
import { planItemToPendingResult } from './resultSnapshot';
import {
  BATCH_VERDICT_JSON_SCHEMA,
  BatchVerdictSchema,
  SINGLE_VERDICT_JSON_SCHEMA,
  type SingleVerdict,
  SingleVerdictSchema,
} from './schema';
import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-executor');

/**
 * Runs a verifier sub-agent (its own agent operation in an isolated thread) to
 * actively investigate one criterion — reading files, running checks — and
 * write its verdict back to the check result. Injected by the runtime layer
 * because it needs full agent-execution context; when absent the agent item is
 * marked skipped.
 */
export interface VerifierAgentRunner {
  (args: {
    checkItem: VerifyCheckItem;
    goal: string;
    operationId: string;
  }): Promise<{ verifierOperationId: string } | null>;
}

export interface ExecuteVerifyParams {
  /** Judge all LLM items in one batched generateObject (default true). */
  batchLlm?: boolean;
  /** The run's final output / artifacts, judged against the criteria. */
  deliverable: string;
  goal: string;
  modelConfig: { model: string; provider: string };
  operationId: string;
  /** Runs `agent`-type checks as verifier sub-agents; agent items skip when absent. */
  runVerifierAgent?: VerifierAgentRunner;
}

const verdictToStatus = (verdict: VerifyVerdict): VerifyCheckResultStatus =>
  verdict === 'passed' ? 'passed' : 'failed';

/** Group a run's evidence rows by the plan item they back, for judge injection. */
type EvidenceByItem = Map<string, JudgeEvidence[]>;

const toToulmin = (v: SingleVerdict): ToulminVerdict => ({
  counterEvidence: v.counterEvidence ?? undefined,
  evidence: v.evidence ?? undefined,
  limitation: v.limitation ?? undefined,
  reasoning: v.reasoning ?? undefined,
});

export class VerifyExecutorService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly runModel: VerifyRunModel;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly statusService: VerifyStatusService;
  private readonly documentModel: DocumentModel;
  private readonly evidenceModel: VerifyEvidenceModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.runModel = new VerifyRunModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.statusService = new VerifyStatusService(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, userId, workspaceId);
    this.evidenceModel = new VerifyEvidenceModel(db, userId, workspaceId);
  }

  /**
   * Resolve a check item's detailed judging instruction — the criterion's rule
   * body lives in its linked document (the single source of truth).
   */
  private async resolveInstruction(item: VerifyCheckItem): Promise<string | undefined> {
    if (!item.documentId) return undefined;
    const doc = await this.documentModel.findById(item.documentId);
    return doc?.content ?? undefined;
  }

  /**
   * Run the confirmed check plan for an operation. LLM items are judged inline;
   * program items are placeholders (v1); agent items are spawned via the injected
   * spawner (results land asynchronously). Recomputes the rollup at the end.
   */
  async execute(params: ExecuteVerifyParams): Promise<void> {
    // Resolve (or lazily create) the verification session bound to this Agent Run.
    const run = await this.runModel.ensureForOperation(params.operationId);
    if (!run.plan?.length) {
      log('execute: no plan for op %s, skipping', params.operationId);
      return;
    }
    if (!run.planConfirmedAt) {
      log('execute: plan for op %s not confirmed, skipping', params.operationId);
      return;
    }

    const verifyRunId = run.id;
    const items = run.plan as VerifyCheckItem[];

    // Idempotently create the pending result rows (skip ones already present —
    // an item may already have a row from evidence uploaded mid-run).
    const existing = await this.resultModel.listByRun(verifyRunId);
    const existingIds = new Set(existing.map((r) => r.checkItemId));
    const toCreate = items
      .filter((i) => !existingIds.has(i.id))
      .map((item) => planItemToPendingResult(verifyRunId, params.operationId, item));
    if (toCreate.length > 0) await this.resultModel.createMany(toCreate);

    await this.statusService.markVerifying(params.operationId);

    // Load run-captured evidence once, grouped by plan item — feeds both the
    // structural gate and the LLM judge.
    const evidenceByItem = await this.loadEvidence(verifyRunId);

    // Structural gate (server, no LLM): an evidence-driven item missing any of
    // its declared evidence types is marked uncertain up front and excluded from
    // the judges — we never let a required artifact-backed claim pass unseen.
    const gapIds = await this.runStructuralGate(verifyRunId, items, evidenceByItem);
    const gated = items.filter((i) => !gapIds.has(i.id));

    const llmItems = gated.filter((i) => i.verifierType === 'llm');
    const agentItems = gated.filter((i) => i.verifierType === 'agent');
    const programItems = gated.filter((i) => i.verifierType === 'program');

    // The three verifier kinds are independent — run them concurrently. LLM items
    // are judged in one batched call; each agent item spawns its own sub-agent.
    await Promise.all([
      this.runProgramItems(verifyRunId, programItems),
      this.runLlmItems(params, verifyRunId, llmItems, evidenceByItem),
      ...agentItems.map((item) => this.runAgentItem(params, verifyRunId, item)),
    ]);

    await this.statusService.recompute(params.operationId);
  }

  /** Load a run's evidence rows grouped by the plan item id they back. */
  private async loadEvidence(verifyRunId: string): Promise<EvidenceByItem> {
    const rows = await this.evidenceModel.listByRun(verifyRunId);
    const byItem: EvidenceByItem = new Map();
    for (const row of rows) {
      const list = byItem.get(row.checkItemId) ?? [];
      list.push({ content: row.content, description: row.description, type: row.type });
      byItem.set(row.checkItemId, list);
    }
    return byItem;
  }

  /**
   * Mark every evidence-driven item whose declared evidence is incomplete as
   * `uncertain` (status `failed`, so it gates delivery and seeds repair), and
   * return their ids so the judges skip them. Items with no `requiredEvidence`
   * pass through untouched.
   */
  private async runStructuralGate(
    verifyRunId: string,
    items: VerifyCheckItem[],
    evidenceByItem: EvidenceByItem,
  ): Promise<Set<string>> {
    const gapIds = new Set<string>();
    for (const item of items) {
      const required = readRequiredEvidence(item.verifierConfig);
      const gaps = coverageGaps(required, evidenceByItem.get(item.id) ?? []);
      if (gaps.length === 0) continue;

      gapIds.add(item.id);
      const missing = gaps.join(', ');
      await this.resultModel.updateByCheckItem(verifyRunId, item.id, {
        completedAt: new Date(),
        confidence: 0,
        status: 'failed',
        suggestion: `Capture and upload the missing evidence (${missing}) via \`lh verify upload-evidence\`.`,
        toulmin: { limitation: `Required evidence not provided: ${missing}.` },
        verdict: 'uncertain',
      });
    }
    return gapIds;
  }

  /** Program verifiers are a v1 placeholder (no shell environment) — mark skipped. */
  private async runProgramItems(verifyRunId: string, items: VerifyCheckItem[]): Promise<void> {
    for (const item of items) {
      await this.resultModel.updateByCheckItem(verifyRunId, item.id, {
        completedAt: new Date(),
        status: 'skipped',
        toulmin: { limitation: 'Program verifier is not executed in v1.' },
      });
    }
  }

  /** Judge all LLM items via the Toulmin judge (one batched call by default). */
  private async runLlmItems(
    params: ExecuteVerifyParams,
    verifyRunId: string,
    items: VerifyCheckItem[],
    evidenceByItem: EvidenceByItem,
  ): Promise<void> {
    if (items.length === 0) return;
    try {
      if (params.batchLlm ?? true) {
        await this.judgeBatch(params, verifyRunId, items, evidenceByItem);
      } else {
        for (const item of items) await this.judgeSingle(params, verifyRunId, item, evidenceByItem);
      }
    } catch (error) {
      log('llm judge failed for op %s: %O', params.operationId, error);
      // Leave failed-to-judge items pending; rollup will report `verifying`.
    }
  }

  /** Run one agent check as a verifier sub-agent (verdict lands async via its hook) or skip. */
  private async runAgentItem(
    params: ExecuteVerifyParams,
    verifyRunId: string,
    item: VerifyCheckItem,
  ): Promise<void> {
    if (!params.runVerifierAgent) {
      await this.resultModel.updateByCheckItem(verifyRunId, item.id, {
        completedAt: new Date(),
        status: 'skipped',
        toulmin: { limitation: 'Agent verifier requires runtime context; not run here.' },
      });
      return;
    }
    try {
      const spawned = await params.runVerifierAgent({
        checkItem: item,
        goal: params.goal,
        operationId: params.operationId,
      });
      await this.resultModel.updateByCheckItem(verifyRunId, item.id, {
        startedAt: new Date(),
        status: 'running',
        verifierOperationId: spawned?.verifierOperationId ?? null,
      });
    } catch (error) {
      log('agent verifier spawn failed for item %s: %O', item.id, error);
      await this.resultModel.updateByCheckItem(verifyRunId, item.id, {
        completedAt: new Date(),
        status: 'failed',
        toulmin: { limitation: 'Agent verifier failed to start.' },
        verdict: 'uncertain',
      });
    }
  }

  private async judgeBatch(
    params: ExecuteVerifyParams,
    verifyRunId: string,
    items: VerifyCheckItem[],
    evidenceByItem: EvidenceByItem,
  ): Promise<void> {
    // Batch: N verdicts share ONE tracing row (N:1).
    const tracingId = randomUUID();
    const promptItems = await Promise.all(
      items.map(async (i) => ({
        evidence: evidenceByItem.get(i.id),
        id: i.id,
        instruction: await this.resolveInstruction(i),
        title: i.title,
      })),
    );
    const { system, user } = buildJudgePrompt({
      deliverable: params.deliverable,
      goal: params.goal,
      items: promptItems,
      mode: 'batch',
    });

    const ai = new AiGenerationService(this.db, this.userId);
    const raw = await ai.generateObject(
      {
        messages: [
          { content: system, role: 'system' as const },
          { content: user, role: 'user' as const },
        ],
        model: params.modelConfig.model,
        provider: params.modelConfig.provider,
        schema: BATCH_VERDICT_JSON_SCHEMA,
      },
      {
        tracing: {
          ...({
            promptVersion: VERIFY_JUDGE_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.VerifyJudge,
            schemaName: BATCH_VERDICT_JSON_SCHEMA.name,
            tracingId,
          } satisfies TracingOptions),
          // Backfill the tracing FK only after the (async, best-effort) tracing
          // row is persisted — verdicts are written with a null link below.
          onPersisted: this.backfillTracing(
            verifyRunId,
            items.map((i) => i.id),
          ),
        },
      },
    );

    const parsed = BatchVerdictSchema.safeParse(raw);
    if (!parsed.success) {
      log('batch judge output invalid: %O', parsed.error.flatten());
      return;
    }

    const validIds = new Set(items.map((i) => i.id));
    for (const v of parsed.data.verdicts) {
      if (!validIds.has(v.checkItemId)) continue;
      await this.writeVerdict({
        checkItemId: v.checkItemId,
        verdict: v,
        verifyRunId,
      });
    }
  }

  private async judgeSingle(
    params: ExecuteVerifyParams,
    verifyRunId: string,
    item: VerifyCheckItem,
    evidenceByItem: EvidenceByItem,
  ): Promise<void> {
    // Per-criterion: each result gets its own tracing row (1:1).
    const tracingId = randomUUID();
    const { system, user } = buildJudgePrompt({
      deliverable: params.deliverable,
      goal: params.goal,
      items: [
        {
          evidence: evidenceByItem.get(item.id),
          id: item.id,
          instruction: await this.resolveInstruction(item),
          title: item.title,
        },
      ],
      mode: 'single',
    });

    const ai = new AiGenerationService(this.db, this.userId);
    const raw = await ai.generateObject(
      {
        messages: [
          { content: system, role: 'system' as const },
          { content: user, role: 'user' as const },
        ],
        model: params.modelConfig.model,
        provider: params.modelConfig.provider,
        schema: SINGLE_VERDICT_JSON_SCHEMA,
      },
      {
        tracing: {
          ...({
            promptVersion: VERIFY_JUDGE_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.VerifyJudge,
            schemaName: SINGLE_VERDICT_JSON_SCHEMA.name,
            tracingId,
          } satisfies TracingOptions),
          onPersisted: this.backfillTracing(verifyRunId, [item.id]),
        },
      },
    );

    const parsed = SingleVerdictSchema.safeParse(raw);
    if (!parsed.success) {
      log('single judge output invalid: %O', parsed.error.flatten());
      return;
    }
    await this.writeVerdict({
      checkItemId: item.id,
      verdict: parsed.data,
      verifyRunId,
    });
  }

  private async writeVerdict(params: {
    checkItemId: string;
    verdict: SingleVerdict;
    verifyRunId: string;
  }): Promise<void> {
    const { verifyRunId, checkItemId, verdict } = params;
    // `verifier_tracing_id` is intentionally left null here — the tracing row is
    // written asynchronously (best-effort, after the response), so linking it now
    // would violate the FK. It is backfilled by `backfillTracing` once the row exists.
    await this.resultModel.updateByCheckItem(verifyRunId, checkItemId, {
      completedAt: new Date(),
      confidence: verdict.confidence,
      status: verdictToStatus(verdict.verdict),
      suggestion: verdict.suggestion ?? null,
      toulmin: toToulmin(verdict),
      verdict: verdict.verdict,
    });
  }

  /**
   * Build the `onPersisted` callback handed to the tracing layer. It fires in the
   * tracing hook's deferred (post-response) continuation once the
   * `llm_generation_tracing` row is committed — only then is it safe to set the
   * FK link. Receives the persisted tracing id (or null if tracing was disabled
   * or the record failed), so a missing tracing row simply leaves the link null.
   */
  private backfillTracing(verifyRunId: string, checkItemIds: string[]) {
    return async (tracingId: string | null): Promise<void> => {
      if (!tracingId) return;
      try {
        await this.resultModel.backfillTracingId(verifyRunId, checkItemIds, tracingId);
      } catch (error) {
        log('tracing-id backfill failed for run %s (non-fatal): %O', verifyRunId, error);
      }
    };
  }
}
