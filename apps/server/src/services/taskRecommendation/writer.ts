import type {
  OnboardingTaskRecommendationProviderGuide,
  OnboardingTaskRecommendationProviderId,
  OnboardingTaskRecommendationWritingGuide,
} from '@lobechat/prompts';
import {
  chainOnboardingTaskRecommendation,
  ONBOARDING_TASK_RECOMMENDATION_JSON_SCHEMA,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';

import type { AiGenerationService } from '@/server/services/aiGeneration';

const recommendationOutputSchema = z.object({
  recommendations: z.array(
    z.object({
      instruction: z.string().trim().min(1).max(4000),
      reason: z.string().trim().min(1).max(1000),
      sourceUrls: z.array(z.string().trim().max(2048)).min(1),
      title: z.string().trim().min(1).max(200),
    }),
  ),
});

/** One validated recommendation returned before connector-source grounding. */
export interface GeneratedTaskRecommendation {
  /** Background-safe instructions for the delegated agent. */
  instruction: string;
  /** User-facing explanation for suggesting the work. */
  reason: string;
  /** Exact connector URLs claimed by the generated recommendation. */
  sourceUrls: string[];
  /** Concise task title that remains meaningful outside the connector UI. */
  title: string;
}

/** Evidence and product policy supplied to one isolated recommendation call. */
export interface TaskRecommendationWriterInput {
  /** Bounded untrusted connector evidence serialized by the provider collector. */
  context: string;
  /** Provider-specific recommendation examples and safety policy. */
  guide: OnboardingTaskRecommendationProviderGuide;
  /** Maximum recommendation count requested from this provider. */
  limit: number;
  /** Connector identifier represented by the evidence. */
  providerId: OnboardingTaskRecommendationProviderId;
  /** Locale used for generated user-facing text. */
  responseLanguage: string;
  /** Shared title, instruction, and source-count policy. */
  writingGuide: OnboardingTaskRecommendationWritingGuide;
}

interface TaskRecommendationWriterDependencies {
  generator: Pick<AiGenerationService, 'generateObject'>;
  writerAgent: () => Promise<{ id: string; model: string; provider: string }>;
}

/** Generates and validates recommendation drafts without owning session persistence. */
export class TaskRecommendationWriter {
  constructor(private readonly dependencies: TaskRecommendationWriterDependencies) {}

  /**
   * Produces structured drafts from one connector's bounded evidence.
   *
   * The returned source URLs remain untrusted model output. The caller must intersect them with
   * its trusted connector sources before exposing or materializing a recommendation.
   */
  generate = async (
    input: TaskRecommendationWriterInput,
  ): Promise<GeneratedTaskRecommendation[]> => {
    const writerAgent = await this.dependencies.writerAgent();
    const output = await this.dependencies.generator.generateObject(
      {
        messages: chainOnboardingTaskRecommendation(input),
        model: writerAgent.model,
        provider: writerAgent.provider,
        schema: ONBOARDING_TASK_RECOMMENDATION_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      },
      { metadata: { trigger: RequestTrigger.Onboarding } },
    );

    return recommendationOutputSchema.parse(output).recommendations;
  };
}
