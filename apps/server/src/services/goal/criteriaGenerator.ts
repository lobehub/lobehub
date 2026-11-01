import { TRACING_SCENARIOS } from '@lobechat/const';
import { isProgrammaticTestCheck } from '@lobechat/const/verify';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import type { GoalClarificationAnswer } from '@lobechat/prompts';
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
import type { GoalConfig, RequiredEvidenceSpec, VerifyCheckItem } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { AiGenerationService } from '@/server/services/aiGeneration';

import { resolveGoalModelConfig } from './modelConfig';

const log = debug('lobe-server:goal-criteria-generator');
const DEFAULT_MAX_CRITERIA = 4;
/**
 * Structured output occasionally comes back empty (e.g. a `{}` tool input) even
 * though the same prompt succeeds on the next call. Ask again a bounded number
 * of times before telling the user the draft failed.
 */
const GOAL_PLAN_MAX_ATTEMPTS = 3;

type EvidenceType = (typeof VERIFY_EVIDENCE_TYPES)[number];

/**
 * Models often put a modality (`image`, `document`, …) where the evidence type
 * belongs — most of all when the goal itself contains an image. One such tag
 * used to reject the whole draft, so translate it to the closest evidence type.
 */
const EVIDENCE_TYPE_BY_MODALITY: Record<(typeof VERIFY_EVIDENCE_MODALITIES)[number], EvidenceType> =
  {
    audio: 'audio',
    document: 'markdown',
    image: 'screenshot',
    structured: 'text',
    text: 'text',
    video: 'video',
  };

const pickEnum = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  values.includes(value as T) ? (value as T) : undefined;

/**
 * Keep a drafted evidence requirement usable instead of failing the plan:
 * map modality-style types, drop invalid optional tags, and drop an entry whose
 * type cannot be recognised at all. The criterion itself is kept either way.
 */
const normalizeEvidenceItem = (item: unknown) => {
  if (!item || typeof item !== 'object') return undefined;
  const { hint, modality, scope, type } = item as Record<string, unknown>;
  const modalityFromType = pickEnum(VERIFY_EVIDENCE_MODALITIES, type);
  const evidenceType =
    pickEnum(VERIFY_EVIDENCE_TYPES, type) ??
    (modalityFromType ? EVIDENCE_TYPE_BY_MODALITY[modalityFromType] : undefined);
  if (!evidenceType) return undefined;

  return {
    hint: typeof hint === 'string' ? hint : undefined,
    modality: pickEnum(VERIFY_EVIDENCE_MODALITIES, modality) ?? modalityFromType,
    scope: pickEnum(VERIFY_EVIDENCE_SCOPES, scope),
    type: evidenceType,
  };
};

const requiredEvidenceSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.map(normalizeEvidenceItem).filter(Boolean) : value),
  z
    .array(
      z.object({
        hint: z.string().optional(),
        modality: z.enum(VERIFY_EVIDENCE_MODALITIES).optional(),
        scope: z.enum(VERIFY_EVIDENCE_SCOPES).optional(),
        type: z.enum(VERIFY_EVIDENCE_TYPES),
      }),
    )
    .optional(),
);

const generatedCriteriaSchema = z.object({
  criteria: z.array(
    z.object({
      description: z.string().optional(),
      instruction: z.string().optional(),
      onFail: z.enum(VERIFY_ON_FAIL_ACTIONS).optional(),
      requiredEvidence: requiredEvidenceSchema,
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
  /** Readings the plan relies on that the goal did not state. */
  assumptions: z.array(z.string()).default([]),
  /** Why one planning pass is not enough; the main Agent plans instead. */
  escalate: z.string().nullish(),
  problemStatement: z.string().min(1),
  /**
   * The planner's batch claim. Present only when it judged the goal to be one
   * repeated mould; the coordinator validates it with `spec.ts` before creating
   * a `batch`, so a planner that over-claims still decomposes normally.
   */
  rollout: z
    .object({
      recipeOutline: z.string().optional(),
      repeatable: z.boolean(),
      /** Honest count of the homogeneous units in the whole goal. */
      unitCount: z.number().int().positive(),
      /** Roster of every homogeneous unit, probes first, in delivery order. */
      units: z.array(z.string().min(1)).default([]),
      /** Axes the units vary along; a probe must cover each declared value. */
      variants: z
        .array(z.object({ axis: z.string().min(1), values: z.array(z.string()) }))
        .default([]),
    })
    .nullable()
    .optional(),
  /**
   * What the planner could not determine and would change the deliverable.
   * Defaulted so an older answer without the field still plans.
   */
  questions: z
    .array(
      z.object({
        assumption: z.string(),
        blocking: z.boolean(),
        impact: z.string().optional(),
        options: z.array(z.string()).default([]),
        question: z.string(),
      }),
    )
    .default([]),
  tasks: z
    .array(
      z.object({
        /** 0-based indices of earlier tasks this one consumes; drives `depends_on` edges. */
        dependsOn: z.array(z.number().int().nonnegative()).optional(),
        /**
         * Present only when the direction is a candidate answer under test; the
         * coordinator then wraps its Task in an experiment container. Ordinary
         * delivery steps carry `null` and attach straight to the problem.
         */
        hypothesis: z.string().max(280).nullable().optional(),
        instruction: z.string().min(1),
        title: z.string().min(1).max(80),
      }),
    )
    .min(1)
    .max(5),
});

export type GoalDecompositionDraft = z.input<typeof decompositionSchema>;

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

    let plan: z.infer<typeof generatedCriteriaSchema> | undefined;
    for (let attempt = 1; !plan && attempt <= GOAL_PLAN_MAX_ATTEMPTS; attempt++) {
      const raw = await ai.generateObject(
        {
          ...chainGoalCriteriaDraft({ ...params, maxCriteria }),
          ...modelConfig,
          schema: GOAL_CRITERIA_DRAFT_JSON_SCHEMA,
          thinking: { type: 'disabled' },
        },
        {
          metadata: { trigger: RequestTrigger.Goal },
          tracing: {
            promptVersion: GOAL_CRITERIA_DRAFT_PROMPT_VERSION,
            scenario: TRACING_SCENARIOS.GoalCriteriaGen,
            schemaName: GOAL_CRITERIA_DRAFT_JSON_SCHEMA.name,
          } satisfies TracingOptions,
        },
      );

      const parsed = generatedCriteriaSchema.safeParse(raw);
      if (parsed.success) {
        plan = parsed.data;
      } else {
        log(
          'goal criteria draft did not match schema (attempt %d/%d): %O',
          attempt,
          GOAL_PLAN_MAX_ATTEMPTS,
          parsed.error.flatten(),
        );
      }
    }

    if (!plan) return undefined;

    const criteria = plan.criteria
      .slice(0, maxCriteria)
      .filter((criterion) => !isProgrammaticTestCheck(criterion.title, criterion.description));

    return { ...plan, criteria };
  }

  /**
   * Plan the opening exploration structure for a goal that has no tasks yet:
   * the core question plus 1–5 independent directions. Throws on a model or
   * schema failure; the coordinator then falls back to a single task seeded
   * from the raw requirement and records why, instead of stalling the goal.
   */
  async decompose({
    goalConfig,
    ...params
  }: {
    clarifications?: GoalClarificationAnswer[];
    /** Carries the goal's planning-model pick, which outranks the system goal model. */
    goalConfig?: GoalConfig | null;
    requirement: string;
  }): Promise<GoalDecompositionDraft> {
    const modelConfig = await resolveGoalModelConfig(this.db, this.userId, goalConfig);
    const ai = new AiGenerationService(this.db, this.userId, this.workspaceId);
    const raw = await ai.generateObject(
      {
        ...chainGoalDecompose(params),
        ...modelConfig,
        schema: GOAL_DECOMPOSE_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      },
      {
        metadata: { trigger: RequestTrigger.Goal },
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
      // Thrown, not swallowed: the coordinator records why it fell back.
      throw new Error(
        `The planner's answer did not match the decomposition schema: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }
}
