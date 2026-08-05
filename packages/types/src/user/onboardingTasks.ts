import { z } from 'zod';

/** One connector record that supports an onboarding task recommendation. */
export interface OnboardingTaskSource {
  /** Email subject retained from trusted connector evidence when the source is Gmail. */
  subject?: string;
  /** Connector kind used by the client to render provider-specific source metadata. */
  type: string;
  /** Exact connector URL retained from collected evidence. */
  url: string;
}

/** One generated onboarding task that can be materialized into the user's task list. */
export interface OnboardingSuggestedTask {
  /** Whether the onboarding UI selects this recommendation initially. */
  checked: boolean;
  /** Stable identifier scoped to the recommendation session. */
  id: string;
  /** Full instruction supplied to the Inbox agent when the task is created. */
  instruction: string;
  /** Connector that supplied the evidence for this recommendation. */
  providerId: string;
  /** Short explanation of why this recommendation is useful now. */
  reason: string;
  /** Connector records that jointly support this recommendation. */
  sources: OnboardingTaskSource[];
  /** Concise user-visible task title. */
  title: string;
}

/** Lifecycle status of an onboarding task recommendation session. */
export type OnboardingTaskRecommendationStatus =
  'pending' | 'processing' | 'completed' | 'partial' | 'failed';

/** A bounded provider failure exposed to polling clients without connector payloads. */
export interface OnboardingTaskRecommendationError {
  /** Stable machine-readable failure category. */
  code: string;
  /** Connector that failed to collect or generate recommendations. */
  providerId: string;
  /** Whether retrying the recommendation workflow may succeed. */
  retryable: boolean;
}

/** Persisted recommendation state attached to the active onboarding topic. */
export interface OnboardingTaskRecommendationSession {
  /** ISO timestamp recorded after the workflow reaches a terminal state. */
  completedAt?: string;
  /** Recommendation IDs mapped to the real task IDs already created from them. */
  createdTaskIds: Record<string, string>;
  /** Provider failures retained when another provider still succeeds. */
  errors: OnboardingTaskRecommendationError[];
  /** Understanding session ID that owns this immutable first-generation run. */
  id: string;
  /** Connected providers used by the recommendation workflow. */
  providerIds: string[];
  /** Generated recommendations in deterministic provider and title order. */
  recommendations: OnboardingSuggestedTask[];
  /** Understanding source fingerprint that caused this session to start. */
  sourceFingerprint: string;
  /** Current workflow lifecycle state. */
  status: OnboardingTaskRecommendationStatus;
  /** ISO timestamp updated whenever the persisted session changes. */
  updatedAt: string;
}

/** Polling response returned by the onboarding task recommendation tRPC endpoints. */
export type OnboardingTaskRecommendationPollingResult = OnboardingTaskRecommendationSession;

/** Input used to read recommendations for one active onboarding topic. */
export interface OnboardingTaskRecommendationTopicInput {
  /** Active personal onboarding topic owned by the authenticated user. */
  topicId: string;
}

/** Input used to materialize selected recommendations as real private tasks. */
export interface CreateOnboardingTasksInput extends OnboardingTaskRecommendationTopicInput {
  /** Recommendation IDs selected by the user. */
  recommendationIds: string[];
  /** Active recommendation session ID used for stale-client protection. */
  sessionId: string;
}

const recommendationSchema = z
  .object({
    checked: z.boolean(),
    id: z.string().min(1).max(128),
    instruction: z.string().trim().min(1).max(4000),
    providerId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(1000),
    sources: z
      .array(
        z
          .object({
            subject: z.string().trim().min(1).max(500).optional(),
            type: z.string().trim().min(1).max(128),
            url: z.string().trim().min(1).max(2048),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    title: z.string().trim().min(1).max(200),
  })
  .strict() satisfies z.ZodType<OnboardingSuggestedTask>;

const recommendationErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    providerId: z.string().min(1).max(128),
    retryable: z.boolean(),
  })
  .strict() satisfies z.ZodType<OnboardingTaskRecommendationError>;

/** Runtime parser for recommendation sessions stored in topic JSON metadata. */
export const OnboardingTaskRecommendationSessionSchema = z
  .object({
    completedAt: z.string().optional(),
    createdTaskIds: z.record(z.string().max(128), z.string().max(512)),
    errors: z.array(recommendationErrorSchema).max(16),
    id: z.string().min(1).max(512),
    providerIds: z.array(z.string().min(1).max(128)).max(16),
    recommendations: z.array(recommendationSchema).max(48),
    sourceFingerprint: z.string().min(1).max(2048),
    status: z.enum(['pending', 'processing', 'completed', 'partial', 'failed']),
    updatedAt: z.string(),
  })
  .strict() satisfies z.ZodType<OnboardingTaskRecommendationSession>;
