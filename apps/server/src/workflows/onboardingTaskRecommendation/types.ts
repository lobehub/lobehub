import { z } from 'zod';

/** Payload for one immutable onboarding task recommendation workflow. */
export interface ProcessOnboardingTaskRecommendationPayload {
  /** Locale used for user-visible recommendation fields. */
  responseLanguage: string;
  /** First completed Understanding session that owns this generation. */
  sessionId: string;
  /** Exact first-published Understanding source revision consumed by this generation. */
  sourceFingerprint: string;
  /** Active personal onboarding topic. */
  topicId: string;
  /** User whose connector credentials and model configuration are used. */
  userId: string;
}

const identifierSchema = z.string().trim().min(1).max(512);

/** Runtime parser for task recommendation workflow requests. */
export const ProcessOnboardingTaskRecommendationPayloadSchema = z
  .object({
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    sessionId: identifierSchema,
    sourceFingerprint: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[\w-]+@\d+(,[\w-]+@\d+)*$/),
    topicId: identifierSchema,
    userId: identifierSchema,
  })
  .strict() satisfies z.ZodType<ProcessOnboardingTaskRecommendationPayload>;

/**
 * Returns the workflow concurrency key for one immutable recommendation session.
 *
 * Use when:
 * - Multiple Understanding providers may finish at nearly the same time
 *
 * Expects:
 * - A validated Understanding session identifier
 *
 * Returns:
 * - A stable key that serializes competing first-source recommendation starts
 */
export const getTaskRecommendationFlowControlKey = (sessionId: string) =>
  `onboarding-task-recommendation.${sessionId}`;
