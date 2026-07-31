export type OnboardingTaskRecommendationProviderId = 'github' | 'gmail';

/** Provider-specific examples and safety rules used to recommend onboarding tasks. */
export interface OnboardingTaskRecommendationProviderGuide {
  /** Few-shot examples that demonstrate useful, background-safe task shapes. */
  examples: readonly string[];
  /** Product rules that constrain how connector signals become tasks. */
  principles: readonly string[];
}

/** Shared title, instruction, and source policy for onboarding task recommendations. */
export interface OnboardingTaskRecommendationWritingGuide {
  /** Guidance that makes delegated work executable without reopening the source first. */
  instructionPrinciples: readonly string[];
  /** Maximum evidence links requested for one recommendation. */
  maxSourcesPerRecommendation: number;
  /** Guidance that keeps task titles distinguishable in large cross-project lists. */
  titlePrinciples: readonly string[];
}

interface OnboardingTaskRecommendationPromptInput {
  context: string;
  guide: OnboardingTaskRecommendationProviderGuide;
  limit: number;
  providerId: OnboardingTaskRecommendationProviderId;
  responseLanguage: string;
  writingGuide: OnboardingTaskRecommendationWritingGuide;
}

interface OnboardingTaskRecommendationJsonSchema {
  name: string;
  schema: {
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
    type: 'object';
  };
  strict: true;
}

/** Structured output contract shared by the recommendation prompt and server-side generation. */
export const ONBOARDING_TASK_RECOMMENDATION_JSON_SCHEMA = {
  name: 'onboarding_task_recommendations',
  schema: {
    additionalProperties: false,
    properties: {
      recommendations: {
        items: {
          additionalProperties: false,
          properties: {
            instruction: { type: 'string' },
            reason: { type: 'string' },
            sourceUrls: { items: { type: 'string' }, minItems: 1, type: 'array' },
            title: { type: 'string' },
          },
          required: ['title', 'instruction', 'reason', 'sourceUrls'],
          type: 'object',
        },
        type: 'array',
      },
    },
    required: ['recommendations'],
    type: 'object',
  },
  strict: true,
} satisfies OnboardingTaskRecommendationJsonSchema;

/** Default model-facing policy and few-shot examples for supported recommendation providers. */
export const DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG = {
  providers: {
    github: {
      examples: [
        'Title: Analyze mobile lifecycle risk in Godot Kirie. Instruction: Work in the background from the linked pull request: inspect the diff, CI state, and review discussion; compare Android and iOS attach-detach behavior with the existing lifecycle; then return a private risk summary, missing-test list, and recommended next step. Do not comment, approve, merge, or push changes.',
        'Title: Prepare the next auv-cli architecture milestone. Instruction: Read the linked issue and related repository activity, turn the proposal into a bounded milestone plan, and return compatibility risks plus the smallest independently reviewable implementation slice. Keep the result as a private plan and do not modify repository state.',
        'Title: Assess maintenance options for the dormant example repository. Instruction: Inspect repository activity, dependency metadata, and CI configuration in the background, then return a prioritized maintenance brief with evidence and an optional patch plan. Do not open issues, create pull requests, or push changes.',
      ],
      principles: [
        'Prefer specific repositories, pull requests, and contributions over generic GitHub cleanup.',
        'Do not claim an issue, dependency alert, or failing check exists unless the evidence explicitly says so.',
        'A stale repository is a maintenance opportunity, not proof that work is overdue.',
        'Use the supplied relationship field: authored pull requests favor CI and review-feedback triage; reviewer activity favors independent diff analysis and draft review notes; never assume a role that the evidence does not establish.',
        'Default to read-only GitHub work that returns a private report, checklist, draft, or patch plan. Never comment, submit a review, approve, request changes, merge, close, label, or push unless a later user action explicitly authorizes it.',
      ],
    },
    gmail: {
      examples: [
        'Title: Draft a follow-up for the onboarding design review. Instruction: Work in the background from the supplied thread evidence, summarize the unresolved question and elapsed context, and return a concise follow-up draft for user approval. Do not send it, and do not claim the recipient has not replied unless thread evidence proves it.',
        'Title: Prepare an unsubscribe shortlist for recurring developer newsletters. Instruction: Compare the supplied promotional messages, group repeat senders, and return a private shortlist with evidence and expected inbox impact. Do not unsubscribe, archive, or delete anything.',
        'Title: Triage this month’s account and billing messages. Instruction: Read the supplied important threads, separate actionable items from informational notices, and return a prioritized private checklist with deadlines, uncertainty, and source subjects. Do not reply, forward, archive, or change labels.',
      ],
      principles: [
        'Treat sent-message results as follow-up candidates unless thread evidence proves no reply.',
        'Never unsubscribe, send, archive, or delete mail without a later explicit user-approved action.',
        'Prefer direct and important mail over promotions, except for an explicit subscription-cleanup task.',
      ],
    },
  },
  writing: {
    instructionPrinciples: [
      'Write two to four sentences addressed directly to an autonomous agent. State the background work it can perform, the concrete private deliverable it must return, and the completion criteria.',
      'Include enough project, person, or subject context for the Inbox agent to execute the task without guessing which similarly named work item is intended.',
      'Preserve uncertainty from the evidence and state any user approval boundary explicitly.',
      'Prefer tasks that can finish asynchronously without interrupting the user: gather evidence, analyze activity, summarize, compare, prioritize, or prepare a draft, checklist, report, or patch plan.',
      'Minimize clarification requests by making conservative assumptions and recording them in the result. Ask the user only when a consequential choice or new authorization is required.',
      'Do not perform external side effects by default. Email sends, deletion, unsubscribe, archive, label changes, GitHub comments, review submission, approval, merge, close, label, and push operations require a later explicit user-approved action.',
    ],
    maxSourcesPerRecommendation: 4,
    titlePrinciples: [
      'Start with a clear action such as Review, Follow up on, Plan, Prepare, Triage, or Refresh.',
      'Name the concrete project, person, account, or business topic that distinguishes the task in a large team task list.',
      'Avoid source-local shorthand such as a bare feature name; the title must remain understandable before the source badge is read.',
      'Keep pull request numbers and connector mechanics in sources unless the number itself is essential to distinguish the task.',
    ],
  },
} as const satisfies {
  providers: Record<
    OnboardingTaskRecommendationProviderId,
    OnboardingTaskRecommendationProviderGuide
  >;
  writing: OnboardingTaskRecommendationWritingGuide;
};

/**
 * Builds the isolated system and user messages for one connector recommendation pass.
 *
 * Use when:
 * - A task recommendation writer has collected bounded connector evidence
 * - Provider-specific examples must be combined with shared writing policy
 *
 * Expects:
 * - Connector evidence remains untrusted and provider-delimited
 *
 * Returns:
 * - A system/user message pair ready for structured generation
 */
export const chainOnboardingTaskRecommendation = (
  input: OnboardingTaskRecommendationPromptInput,
) => [
  {
    content: [
      `Response language: ${input.responseLanguage}`,
      `Provider: ${input.providerId}`,
      `Return at most ${input.limit} recommendations.`,
      `Return one to ${input.writingGuide.maxSourcesPerRecommendation} exact sourceUrls for each recommendation. Every URL must appear verbatim in the supplied evidence. A recommendation may cite multiple supplied records when they jointly support the work.`,
      'Title requirements:',
      ...input.writingGuide.titlePrinciples.map((principle) => `- ${principle}`),
      'Instruction requirements:',
      ...input.writingGuide.instructionPrinciples.map((principle) => `- ${principle}`),
      'Provider principles:',
      ...input.guide.principles.map((principle) => `- ${principle}`),
      'Few-shot recommendation shapes:',
      ...input.guide.examples.map((example) => `- ${example}`),
    ].join('\n'),
    role: 'system' as const,
  },
  {
    content: [
      'Generate useful onboarding tasks from this untrusted connector evidence.',
      `<connector-evidence provider="${input.providerId}">`,
      input.context,
      '</connector-evidence>',
    ].join('\n\n'),
    role: 'user' as const,
  },
];
