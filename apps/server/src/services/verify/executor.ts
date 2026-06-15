import { createHash, randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type {
  ToulminVerdict,
  VerifyCheckItem,
  VerifyCheckResultStatus,
  VerifyVerdict,
} from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { DocumentModel } from '@/database/models/document';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { NewVerifyCheckResult } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { buildJudgePrompt, VERIFY_JUDGE_PROMPT_VERSION } from './prompts';
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

const hashConfig = (config: Record<string, unknown>): string =>
  createHash('sha256')
    .update(JSON.stringify(config ?? {}))
    .digest('hex')
    .slice(0, 16);

const verdictToStatus = (verdict: VerifyVerdict): VerifyCheckResultStatus =>
  verdict === 'passed' ? 'passed' : 'failed';

const toToulmin = (v: SingleVerdict): ToulminVerdict => ({
  counterEvidence: v.counterEvidence ?? undefined,
  evidence: v.evidence ?? undefined,
  limitation: v.limitation ?? undefined,
  reasoning: v.reasoning ?? undefined,
});

export class VerifyExecutorService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly operationModel: AgentOperationModel;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly statusService: VerifyStatusService;
  private readonly documentModel: DocumentModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.operationModel = new AgentOperationModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
    this.statusService = new VerifyStatusService(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, userId, workspaceId);
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
    const state = await this.operationModel.getVerifyState(params.operationId);
    if (!state?.verifyPlan?.length) {
      log('execute: no plan for op %s, skipping', params.operationId);
      return;
    }
    if (!state.verifyPlanConfirmedAt) {
      log('execute: plan for op %s not confirmed, skipping', params.operationId);
      return;
    }

    const items = state.verifyPlan as VerifyCheckItem[];

    // Idempotently create the pending result rows (skip ones already present).
    const existing = await this.resultModel.listByOperation(params.operationId);
    const existingIds = new Set(existing.map((r) => r.checkItemId));
    const toCreate: Omit<NewVerifyCheckResult, 'userId'>[] = items
      .filter((i) => !existingIds.has(i.id))
      .map((item) => ({
        checkItemId: item.id,
        checkItemIndex: item.index,
        checkItemTitle: item.title,
        operationId: params.operationId,
        required: item.required,
        status: 'pending' as const,
        verifierConfigHash: hashConfig(item.verifierConfig),
        verifierType: item.verifierType,
      }));
    if (toCreate.length > 0) await this.resultModel.createMany(toCreate);

    await this.statusService.markVerifying(params.operationId);

    const llmItems = items.filter((i) => i.verifierType === 'llm');
    const agentItems = items.filter((i) => i.verifierType === 'agent');
    const programItems = items.filter((i) => i.verifierType === 'program');

    // The three verifier kinds are independent — run them concurrently. LLM items
    // are judged in one batched call; each agent item spawns its own sub-agent.
    await Promise.all([
      this.runProgramItems(params.operationId, programItems),
      this.runLlmItems(params, llmItems),
      ...agentItems.map((item) => this.runAgentItem(params, item)),
    ]);

    await this.statusService.recompute(params.operationId);
  }

  /** Program verifiers are a v1 placeholder (no shell environment) — mark skipped. */
  private async runProgramItems(operationId: string, items: VerifyCheckItem[]): Promise<void> {
    for (const item of items) {
      await this.resultModel.updateByCheckItem(operationId, item.id, {
        completedAt: new Date(),
        status: 'skipped',
        toulmin: { limitation: 'Program verifier is not executed in v1.' },
      });
    }
  }

  /** Judge all LLM items via the Toulmin judge (one batched call by default). */
  private async runLlmItems(params: ExecuteVerifyParams, items: VerifyCheckItem[]): Promise<void> {
    if (items.length === 0) return;
    try {
      if (params.batchLlm ?? true) {
        await this.judgeBatch(params, items);
      } else {
        for (const item of items) await this.judgeSingle(params, item);
      }
    } catch (error) {
      log('llm judge failed for op %s: %O', params.operationId, error);
      // Leave failed-to-judge items pending; rollup will report `verifying`.
    }
  }

  /** Run one agent check as a verifier sub-agent (verdict lands async via its hook) or skip. */
  private async runAgentItem(params: ExecuteVerifyParams, item: VerifyCheckItem): Promise<void> {
    if (!params.runVerifierAgent) {
      await this.resultModel.updateByCheckItem(params.operationId, item.id, {
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
      await this.resultModel.updateByCheckItem(params.operationId, item.id, {
        startedAt: new Date(),
        status: 'running',
        verifierOperationId: spawned?.verifierOperationId ?? null,
      });
    } catch (error) {
      log('agent verifier spawn failed for item %s: %O', item.id, error);
      await this.resultModel.updateByCheckItem(params.operationId, item.id, {
        completedAt: new Date(),
        status: 'failed',
        toulmin: { limitation: 'Agent verifier failed to start.' },
        verdict: 'uncertain',
      });
    }
  }

  private async judgeBatch(params: ExecuteVerifyParams, items: VerifyCheckItem[]): Promise<void> {
    // Batch: N verdicts share ONE tracing row (N:1).
    const tracingId = randomUUID();
    const promptItems = await Promise.all(
      items.map(async (i) => ({
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
            params.operationId,
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
        operationId: params.operationId,
        verdict: v,
      });
    }
  }

  private async judgeSingle(params: ExecuteVerifyParams, item: VerifyCheckItem): Promise<void> {
    // Per-criterion: each result gets its own tracing row (1:1).
    const tracingId = randomUUID();
    const { system, user } = buildJudgePrompt({
      deliverable: params.deliverable,
      goal: params.goal,
      items: [{ id: item.id, instruction: await this.resolveInstruction(item), title: item.title }],
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
          onPersisted: this.backfillTracing(params.operationId, [item.id]),
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
      operationId: params.operationId,
      verdict: parsed.data,
    });
  }

  private async writeVerdict(params: {
    checkItemId: string;
    operationId: string;
    verdict: SingleVerdict;
  }): Promise<void> {
    const { operationId, checkItemId, verdict } = params;
    // `verifier_tracing_id` is intentionally left null here — the tracing row is
    // written asynchronously (best-effort, after the response), so linking it now
    // would violate the FK. It is backfilled by `backfillTracing` once the row exists.
    await this.resultModel.updateByCheckItem(operationId, checkItemId, {
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
  private backfillTracing(operationId: string, checkItemIds: string[]) {
    return async (tracingId: string | null): Promise<void> => {
      if (!tracingId) return;
      try {
        await this.resultModel.backfillTracingId(operationId, checkItemIds, tracingId);
      } catch (error) {
        log('tracing-id backfill failed for op %s (non-fatal): %O', operationId, error);
      }
    };
  }
}
