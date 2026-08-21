import { TRACING_SCENARIOS } from '@lobechat/const';
import { isProgrammaticTestCheck } from '@lobechat/const/verify';
import type { TracingOptions } from '@lobechat/llm-generation-tracing';
import {
  chainGoalCriteriaDraft,
  GOAL_CRITERIA_DRAFT_JSON_SCHEMA,
  GOAL_CRITERIA_DRAFT_PROMPT_VERSION,
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
            modality: z.string().optional(),
            scope: z.string().optional(),
            type: z.string(),
          }),
        )
        .optional(),
      required: z.boolean().optional(),
      title: z.string(),
      verifierType: z.enum(VERIFY_VERIFIER_TYPES),
    }),
  ),
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
      return [];
    }

    return parsed.data.criteria
      .slice(0, maxCriteria)
      .filter(
        (criterion) => !isProgrammaticTestCheck(criterion.title, criterion.description),
      ) as GoalCriterionDraft[];
  }
}
