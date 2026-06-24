import { randomUUID } from 'node:crypto';

import { TRACING_SCENARIOS, VERIFY_INSTRUCTION_FILE_TYPE } from '@lobechat/const';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';

import { DocumentModel } from '@/database/models/document';
import { VerifyCriterionModel } from '@/database/models/verifyCriterion';
import { VerifyRubricModel } from '@/database/models/verifyRubric';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { VerifyCriterionItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { buildPlanPrompt, VERIFY_PLAN_PROMPT_VERSION } from './prompts';
import { GENERATED_CRITERIA_JSON_SCHEMA, RawGeneratedCriteriaSchema } from './schema';

const log = debug('lobe-server:verify-plan-generator');

const DEFAULT_MAX_AI_CRITERIA = 4;

export interface GeneratePlanParams {
  /** Optional run context appended to the AI prompt (agent role, repo, constraints). */
  context?: string;
  /** Ask the LLM to propose additional criteria beyond the mounted ones. */
  enableAiGeneration?: boolean;
  /** The user's task / instruction text the run must satisfy. */
  goal: string;
  /**
   * When the run opted into verify but produced no decomposed criteria, synthesize
   * a single agent-type holistic check (the coarse "one broad agent verify"
   * default, LOBE-10755) instead of leaving an empty plan (→ verify no-op).
   */
  holisticFallback?: boolean;
  maxAiCriteria?: number;
  /** Required only when `enableAiGeneration` is true. */
  modelConfig?: { model: string; provider: string };
  operationId: string;
  /** One-sentence acceptance the holistic check verifies against (falls back to `goal`). */
  requirement?: string;
  /** Ad-hoc criteria mounted on the agent (`agencyConfig.verifyCriteriaIds`). */
  verifyCriteriaIds?: string[];
  /** Reusable rubric mounted on the agent (`agencyConfig.verifyRubricId`). */
  verifyRubricId?: string | null;
}

/** One agent-authored check, fully specified by the model (the `generateVerifyPlan` tool). */
export interface CriterionDraft {
  /** One-sentence summary; stored on the `verify_criteria.description` column. */
  description?: string;
  /**
   * Reuse an existing instruction document instead of creating one from
   * `instruction`. Set when re-persisting a hydrated criterion so its detailed
   * rubric (the doc body) is preserved rather than dropped to null.
   */
  documentId?: string | null;
  /** The detailed judging rubric; stored as the linked document's content. */
  instruction?: string;
  onFail?: VerifyCheckItem['onFail'];
  required?: boolean;
  title: string;
  /** Verifier knobs (e.g. `requiredEvidence`) — attached when the user adds them. */
  verifierConfig?: Record<string, unknown>;
  verifierType?: VerifyCheckItem['verifierType'];
}

/**
 * Synthesize a single `agent`-type holistic check from the task's acceptance
 * requirement (or its goal). The agent verifier investigates the whole
 * deliverable and submits one verdict — the coarse "one broad agent verify"
 * default for tasks that opted into verify without decomposing into criteria
 * (LOBE-10755). No `requiredEvidence` hard gate: the agent self-captures, so the
 * structural gate never marks it uncertain for "missing evidence".
 */
const buildHolisticAgentItem = (requirement?: string, goal?: string): VerifyCheckItem => {
  const acceptance = requirement?.trim() || goal?.trim() || 'The deliverable fulfills the task.';
  return {
    description: acceptance,
    id: randomUUID(),
    index: 0,
    // Delegate the fail decision to the task bridge (pass→completed / fail→brief)
    // rather than the operation-level auto-repair loop.
    onFail: 'manual',
    required: true,
    title: 'Task delivery acceptance',
    verifierConfig: {},
    verifierType: 'agent',
  };
};

const criterionToCheckItem = (
  criterion: VerifyCriterionItem,
  index: number,
  sourceRubricId: string | null,
): VerifyCheckItem => ({
  description: criterion.description ?? undefined,
  documentId: criterion.documentId ?? undefined,
  id: randomUUID(),
  index,
  onFail: criterion.onFail,
  required: criterion.required,
  sourceCriterionId: criterion.id,
  sourceRubricId,
  title: criterion.title,
  verifierConfig: (criterion.verifierConfig as Record<string, unknown>) ?? {},
  verifierType: criterion.verifierType,
});

export class VerifyPlanGeneratorService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly criterionModel: VerifyCriterionModel;
  private readonly rubricModel: VerifyRubricModel;
  private readonly runModel: VerifyRunModel;
  private readonly documentModel: DocumentModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.criterionModel = new VerifyCriterionModel(db, userId, workspaceId);
    this.rubricModel = new VerifyRubricModel(db, userId, workspaceId);
    this.runModel = new VerifyRunModel(db, userId, workspaceId);
    this.documentModel = new DocumentModel(db, userId, workspaceId);
  }

  /**
   * The agent-authored path (the `generateVerifyPlan` tool): the model enumerates
   * the checks itself, so we (1) create a `verify_criteria` row per check, (2)
   * create a `verify_rubric` titled by the goal and aggregate the criteria under
   * it (reusable), (3) snapshot the rubric onto the operation and confirm it so
   * the checks run automatically on completion. Mirrors `createDocument`: full
   * creation from the model's input, not instantiation of a pre-existing rubric.
   */
  async createPlanFromCriteria(params: {
    criteria: CriterionDraft[];
    operationId: string;
    title: string;
  }): Promise<{ items: VerifyCheckItem[]; rubricId: string }> {
    // 1. Create the rubric (the run's named, reusable delivery standard).
    const rubric = await this.rubricModel.create({ title: params.title });

    // 2. Create each criterion and build the frozen snapshot items in one pass.
    const items: VerifyCheckItem[] = [];
    const links: { criterionId: string; sortOrder: number }[] = [];
    for (const [index, draft] of params.criteria.entries()) {
      // Default to auto-repair: a failing check should attempt a fix rather than
      // silently waiting for manual intervention.
      const onFail = draft.onFail ?? 'auto_repair';
      const required = draft.required ?? true;
      const verifierType = draft.verifierType ?? 'llm';

      // The detailed judging instruction is the criterion's rule body — it lives
      // in a document (editable, history-tracked), referenced by documentId.
      let documentId: string | null = null;
      if (draft.instruction) {
        const doc = await this.documentModel.create({
          content: draft.instruction,
          fileType: VERIFY_INSTRUCTION_FILE_TYPE,
          source: `verify-criterion:${rubric.id}:${index}`,
          sourceType: 'agent',
          title: draft.title,
          totalCharCount: draft.instruction.length,
          totalLineCount: draft.instruction.split('\n').length,
        });
        documentId = doc.id;
      }

      const criterion = await this.criterionModel.create({
        description: draft.description,
        documentId,
        onFail,
        required,
        title: draft.title,
        verifierConfig: {},
        verifierType,
      });

      links.push({ criterionId: criterion.id, sortOrder: index });
      items.push({
        description: draft.description,
        documentId,
        id: randomUUID(),
        index,
        onFail,
        required,
        sourceCriterionId: criterion.id,
        sourceRubricId: rubric.id,
        title: draft.title,
        verifierConfig: {},
        verifierType,
      });
    }

    // 3. Aggregate the criteria under the rubric (criteria reusable across rubrics).
    await this.rubricModel.setCriteria(rubric.id, links);

    // 4. Snapshot onto the run + confirm so it runs when the op completes.
    const run = await this.runModel.ensureForOperation(params.operationId, { title: params.title });
    await this.runModel.setPlan(run.id, items);
    await this.runModel.confirmPlan(run.id);

    log(
      'created rubric %s with %d criteria for op %s',
      rubric.id,
      items.length,
      params.operationId,
    );
    return { items, rubricId: rubric.id };
  }

  /**
   * Config-time AI generation: turn a one-sentence acceptance requirement into a
   * set of proposed criteria for the user to review/edit before saving. Runs the
   * SAME traced generation as the run-time plan path (`buildPlanPrompt` +
   * `GENERATED_CRITERIA_JSON_SCHEMA` + `TRACING_SCENARIOS.VerifyPlanGen`), so each
   * call lands in `llm_generation_tracing` for later precision work. Returns
   * drafts only — nothing is persisted and no operation is required.
   */
  async generateCriteria(params: {
    context?: string;
    goal: string;
    maxCriteria?: number;
    modelConfig: { model: string; provider: string };
  }): Promise<CriterionDraft[]> {
    const maxCriteria = params.maxCriteria ?? DEFAULT_MAX_AI_CRITERIA;
    const { system, user } = buildPlanPrompt({
      context: params.context,
      goal: params.goal,
      maxCriteria,
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
        schema: GENERATED_CRITERIA_JSON_SCHEMA,
      },
      {
        tracing: {
          promptVersion: VERIFY_PLAN_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.VerifyPlanGen,
          schemaName: GENERATED_CRITERIA_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    const parsed = RawGeneratedCriteriaSchema.safeParse(raw);
    if (!parsed.success) {
      log('config criteria-gen output did not match schema: %O', parsed.error.flatten());
      return [];
    }
    return parsed.data.criteria.slice(0, maxCriteria).map((c) => ({
      description: c.description,
      instruction: c.instruction,
      onFail: c.onFail ?? 'manual',
      required: c.required ?? true,
      title: c.title,
      verifierType: c.verifierType,
    }));
  }

  /**
   * Persist a list of (possibly user-edited) drafts as standalone `verify_criteria`
   * rows and return their ids in order — the "ad-hoc criteria" a task mounts via
   * `TaskVerifyConfig.verifyCriteriaIds`. The detailed instruction (if any) lands
   * in a linked document, mirroring the rubric path.
   */
  async createCriteriaFromDrafts(drafts: CriterionDraft[]): Promise<string[]> {
    const ids: string[] = [];
    for (const [index, draft] of drafts.entries()) {
      // Reuse the existing instruction doc when re-persisting a hydrated criterion;
      // only create a fresh doc for a genuinely new draft that carries inline text.
      let documentId: string | null = draft.documentId ?? null;
      if (!documentId && draft.instruction) {
        const doc = await this.documentModel.create({
          content: draft.instruction,
          fileType: VERIFY_INSTRUCTION_FILE_TYPE,
          source: `verify-criterion:adhoc:${index}`,
          sourceType: 'agent',
          title: draft.title,
          totalCharCount: draft.instruction.length,
          totalLineCount: draft.instruction.split('\n').length,
        });
        documentId = doc.id;
      }
      const criterion = await this.criterionModel.create({
        description: draft.description,
        documentId,
        onFail: draft.onFail ?? 'manual',
        required: draft.required ?? true,
        title: draft.title,
        verifierConfig: draft.verifierConfig ?? {},
        verifierType: draft.verifierType ?? 'llm',
      });
      ids.push(criterion.id);
    }
    return ids;
  }

  /**
   * Build a draft check plan for a run: instantiate the mounted rubric + ad-hoc
   * criteria into frozen snapshot items, optionally appending AI-proposed
   * criteria, then persist it onto the operation (`verifyStatus` → 'planned').
   * Returns the plan items.
   */
  async generateDraftPlan(params: GeneratePlanParams): Promise<VerifyCheckItem[]> {
    const items: VerifyCheckItem[] = [];

    // 1. Instantiate the mounted rubric's criteria (in rubric order).
    if (params.verifyRubricId) {
      const rubricCriteria = await this.rubricModel.getCriteria(params.verifyRubricId);
      for (const c of rubricCriteria) {
        items.push(criterionToCheckItem(c, items.length, params.verifyRubricId));
      }
    }

    // 2. Instantiate ad-hoc criteria, skipping any already pulled in via the rubric.
    if (params.verifyCriteriaIds?.length) {
      const seen = new Set(items.map((i) => i.sourceCriterionId).filter(Boolean));
      const adHoc = await this.criterionModel.findByIds(params.verifyCriteriaIds);
      for (const c of adHoc) {
        if (seen.has(c.id)) continue;
        items.push(criterionToCheckItem(c, items.length, null));
      }
    }

    // 3. AI-generate complementary criteria (the "auto-create verify" path).
    if (params.enableAiGeneration && params.modelConfig) {
      try {
        const generated = await this.generateCriteriaWithAi({
          context: params.context,
          existingTitles: items.map((i) => i.title),
          goal: params.goal,
          maxCriteria: params.maxAiCriteria ?? DEFAULT_MAX_AI_CRITERIA,
          modelConfig: params.modelConfig,
          operationId: params.operationId,
        });
        for (const item of generated) {
          items.push({ ...item, index: items.length });
        }
      } catch (error) {
        // AI generation is best-effort — a failure must not block the run.
        log('AI criteria generation failed: %O', error);
      }
    }

    // 4. Holistic fallback: opted into verify but nothing decomposed into
    //    criteria — synthesize one agent-type check over the whole deliverable
    //    so verify actually runs (instead of an empty plan → no-op).
    if (items.length === 0 && params.holisticFallback) {
      items.push(buildHolisticAgentItem(params.requirement, params.goal));
      log('synthesized holistic agent check for op %s', params.operationId);
    }

    const run = await this.runModel.ensureForOperation(params.operationId, { goal: params.goal });
    await this.runModel.setPlan(run.id, items);
    log('generated draft plan for op %s with %d items', params.operationId, items.length);

    return items;
  }

  private async generateCriteriaWithAi(params: {
    context?: string;
    existingTitles: string[];
    goal: string;
    maxCriteria: number;
    modelConfig: { model: string; provider: string };
    operationId: string;
  }): Promise<VerifyCheckItem[]> {
    const { system, user } = buildPlanPrompt({
      context: params.context,
      existingTitles: params.existingTitles,
      goal: params.goal,
      maxCriteria: params.maxCriteria,
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
        schema: GENERATED_CRITERIA_JSON_SCHEMA,
      },
      {
        tracing: {
          promptVersion: VERIFY_PLAN_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.VerifyPlanGen,
          schemaName: GENERATED_CRITERIA_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    const parsed = RawGeneratedCriteriaSchema.safeParse(raw);
    if (!parsed.success) {
      log('AI plan-gen output did not match schema: %O', parsed.error.flatten());
      return [];
    }

    // Like the agent-authored path, the detailed instruction lives in a document
    // (the single source of truth) referenced by documentId — never inline.
    return Promise.all(
      parsed.data.criteria.slice(0, params.maxCriteria).map(async (c) => {
        let documentId: string | null = null;
        if (c.instruction) {
          const doc = await this.documentModel.create({
            content: c.instruction,
            fileType: VERIFY_INSTRUCTION_FILE_TYPE,
            source: `verify-criterion:ai:${params.operationId}`,
            sourceType: 'agent',
            title: c.title,
            totalCharCount: c.instruction.length,
            totalLineCount: c.instruction.split('\n').length,
          });
          documentId = doc.id;
        }
        return {
          description: c.description,
          documentId,
          id: randomUUID(),
          index: 0, // re-indexed by the caller
          onFail: c.onFail ?? 'manual',
          required: c.required ?? true,
          sourceCriterionId: null,
          sourceRubricId: null,
          title: c.title,
          verifierConfig: {},
          verifierType: c.verifierType,
        };
      }),
    );
  }
}
