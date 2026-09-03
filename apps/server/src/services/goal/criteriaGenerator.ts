import { TRACING_SCENARIOS } from '@lobechat/const';
import { isProgrammaticTestCheck } from '@lobechat/const/verify';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainGoalCriteriaDraft,
  chainGoalDecompose,
  GOAL_CRITERIA_DRAFT_JSON_SCHEMA,
  GOAL_CRITERIA_DRAFT_PROMPT_VERSION,
  GOAL_DECOMPOSE_JSON_SCHEMA,
  GOAL_DECOMPOSE_PROMPT_VERSION,
  VERIFY_EVIDENCE_MODALITIES,
  VERIFY_EVIDENCE_SCOPES,
  VERIFY_EVIDENCE_TYPES,
  VERIFY_ON_FAIL_ACTIONS,
  VERIFY_VERIFIER_TYPES,
} from '@lobechat/prompts';
import type { RequiredEvidenceSpec, VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveGoalModelConfig } from './modelConfig';

const log = debug('lobe-server:goal-criteria-generator');
const DEFAULT_MAX_CRITERIA = 4;

const generatedCriteriaSchema = z.object({
  criteria: z.array(
    z.object({
      description: z.string().optional(),
      instruction: z.string().optional(),
      onFail: z.enum(VERIFY_ON_FAIL_ACTIONS).optional(),
      requiredEvidence: z
        .array(
          z.object({
            hint: z.string().optional(),
            modality: z.enum(VERIFY_EVIDENCE_MODALITIES).optional(),
            scope: z.enum(VERIFY_EVIDENCE_SCOPES).optional(),
            type: z.enum(VERIFY_EVIDENCE_TYPES),
          }),
        )
        .optional(),
      required: z.boolean().optional(),
      title: z.string(),
      verifierType: z.enum(VERIFY_VERIFIER_TYPES),
    }),
  ),
  instruction: z.string().min(1),
  title: z.string().min(1).max(80),
});

export interface GoalCriterionDraft {
  description?: string;
  instruction?: string;
  onFail?: VerifyCheckItem['onFail'];
  required?: boolean;
  requiredEvidence?: RequiredEvidenceSpec[];
  title: string;
  verifierType?: VerifyCheckItem['verifierType'];
}

export interface GoalPlanDraft {
  criteria: GoalCriterionDraft[];
  instruction: string;
  title: string;
}

const decompositionSchema = z.object({
  problemStatement: z.string().min(1),
  tasks: z
    .array(
      z.object({
        /** 0-based indices of earlier tasks this one consumes; drives `depends_on` edges. */
        dependsOn: z.array(z.number().int().nonnegative()).optional(),
        instruction: z.string().min(1),
        title: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(5),
});

export type GoalDecompositionDraft = z.infer<typeof decompositionSchema>;

export class GoalCriteriaGeneratorService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  async generate(params: {
    context?: string;
    goal: string;
    maxCriteria?: number;
  }): Promise<GoalCriterionDraft[]> {
    const plan = await this.generatePlan(params);

    return plan?.criteria ?? [];
  }

  async generatePlan(params: {
    context?: string;
    goal: string;
    maxCriteria?: number;
  }): Promise<GoalPlanDraft | undefined> {
    const maxCriteria = params.maxCriteria ?? DEFAULT_MAX_CRITERIA;
    const modelConfig = await resolveGoalModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const raw = await ai.generateObject(
      {
        ...chainGoalCriteriaDraft({ ...params, maxCriteria }),
        ...modelConfig,
        schema: GOAL_CRITERIA_DRAFT_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      },
      {
        metadata: { trigger: 'goal_criteria_draft' },
        tracing: {
          promptVersion: GOAL_CRITERIA_DRAFT_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.GoalCriteriaGen,
          schemaName: GOAL_CRITERIA_DRAFT_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    const parsed = generatedCriteriaSchema.safeParse(raw);
    if (!parsed.success) {
      log('goal criteria draft did not match schema: %O', parsed.error.flatten());
      return undefined;
    }

    const criteria = parsed.data.criteria
      .slice(0, maxCriteria)
      .filter((criterion) => !isProgrammaticTestCheck(criterion.title, criterion.description));

    return { ...parsed.data, criteria };
  }

  /**
   * Plan the opening exploration structure for a goal that has no tasks yet:
   * the core question plus 1–5 independent directions. Returns undefined on
   * any model/schema failure so the coordinator can fall back to a single
   * task seeded from the raw requirement instead of stalling the goal.
   */
  async decompose(params: { requirement: string }): Promise<GoalDecompositionDraft | undefined> {
    const modelConfig = await resolveGoalModelConfig(this.db, this.userId);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const raw = await ai.generateObject(
      {
        ...chainGoalDecompose(params),
        ...modelConfig,
        schema: GOAL_DECOMPOSE_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      },
      {
        metadata: { trigger: 'goal_decompose' },
        tracing: {
          promptVersion: GOAL_DECOMPOSE_PROMPT_VERSION,
          scenario: TRACING_SCENARIOS.GoalDecompose,
          schemaName: GOAL_DECOMPOSE_JSON_SCHEMA.name,
        } satisfies TracingOptions,
      },
    );

    const parsed = decompositionSchema.safeParse(raw);
    if (!parsed.success) {
      log('goal decomposition did not match schema: %O', parsed.error.flatten());
      return undefined;
    }
    return parsed.data;
  }
}
