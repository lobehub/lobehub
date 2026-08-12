/** Connector identifier supplied by a registered task recommendation provider. */
export type OnboardingTaskRecommendationProviderId = string;

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

/** Provider prompt configuration with optional policies activated by trusted runtime conditions. */
interface OnboardingTaskRecommendationProviderPromptConfig extends OnboardingTaskRecommendationProviderGuide {
  /** Writing policy used when a Notion collector establishes a stale-dominant bounded scan. */
  staleWorkspacePrinciples?: readonly string[];
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
    notion: {
      examples: [
        'Title: Prepare the next launch checklist from the Product Launch page. Instruction: Read the linked Notion page in the background, group its unchecked items by dependency and owner evidence, and return a private prioritized checklist with ambiguous ownership called out. Do not edit the page, check boxes, assign people, or post comments.',
        'Title: Review unresolved decisions in the API redesign notes. Instruction: Inspect the linked planning page, extract TODO, TBD, and decision markers with their surrounding context, and return a private decision brief that separates confirmed choices from open questions. Do not modify the document or notify collaborators.',
        'Title: Assess whether the dormant onboarding runbook needs refresh. Instruction: Compare the linked page’s last-edit date, structure, and visible content, then return a private maintenance assessment with stale sections and a proposed review plan. Treat age as a review signal rather than proof that the page is obsolete, and do not edit or archive it.',
      ],
      principles: [
        'Prefer pages with explicit unchecked tasks, TODO or TBD markers, decision notes, or concrete maintenance signals over generic recently edited documents.',
        'A page being accessible does not establish that the user authored, owns, or is responsible for it.',
        'Treat old pages as review opportunities, not proof that content is obsolete or work is overdue.',
        'Default to read-only work that returns a private checklist, decision brief, synthesis, or maintenance plan. Never edit pages, check tasks, change properties, comment, mention collaborators, move, duplicate, or archive content without later explicit user approval.',
      ],
      staleWorkspacePrinciples: [
        'The runtime has established that the bounded accessible Notion scan is dominated by items older than the configured freshness threshold. Return exactly one recommendation, centered on coverage and freshness rather than the subject matter of the old pages.',
        'A small minority of recently edited items does not by itself prove that the old subject matter is current. A recent item may be a hub, index, or access-related page; treat current work as unknown unless the supplied evidence explicitly establishes it.',
        'Do not turn old TODOs, unchecked boxes, decisions, or technical topics into current execution work. Their age makes current ownership, priority, and validity unknown until the user reviews them.',
        'The recommendation must produce a private coverage summary and a short user-facing checklist to verify the Notion workspace, account, integration, page, and Teamspace access; look for or authorize more recent pages; and only then decide which old pages to refresh, retain, or archive.',
        'Describe incomplete authorization only as a possibility. Never claim that newer or unauthorized pages exist, and never ask the agent to bypass Notion access controls.',
      ],
    },
    twitter: {
      examples: [
        'Title: Prepare a reply shortlist for recent X questions. Instruction: Review the linked public mentions in the background, group genuine questions and useful feedback by topic, and return a private prioritized shortlist with concise draft replies and uncertainty called out. Do not post, reply, like, repost, follow, or send direct messages.',
        'Title: Analyze discussion around the recent product launch post. Instruction: Compare the linked authored post with its supplied public discussion signals, summarize recurring reactions and unanswered questions, and return a private response brief plus suggested follow-up themes. Treat engagement as attention rather than approval, and do not perform any X action.',
        'Title: Prepare the next X content brief from recent engineering posts. Instruction: Synthesize the linked authored posts into a private brief of recurring themes, audience questions, and two differentiated draft directions. Preserve the user’s demonstrated voice without inventing opinions, and leave publishing for explicit user approval.',
      ],
      principles: [
        'Use only supplied authored posts and public mentions from the recent-search window; missing activity is not evidence that a topic or audience interest does not exist.',
        'Keep authored posts distinct from third-party mentions, replies, and quotes. Never attribute another account’s statement or intent to the user.',
        'Treat likes, reposts, replies, quotes, and view counts as attention signals rather than approval, urgency, or an obligation to respond.',
        'Prefer private analysis, response triage, content briefs, and draft replies that can be reviewed later. Never post, reply, like, repost, quote, follow, unfollow, mute, block, bookmark, or send a direct message without later explicit user approval.',
      ],
    },
  },
  writing: {
    instructionPrinciples: [
      'Write two to four sentences addressed directly to an autonomous agent. State the background work it can perform, the concrete private deliverable it must return, and the completion criteria.',
      'Select only the highest-value recommendations for this provider. Rank evidence by urgency, recurrence, user impact, and leverage; when the limit is two, return the two strongest distinct candidates in that order. Skip low-signal, generic, duplicated, or merely convenient work.',
      'Include enough project, person, or subject context for the Inbox agent to execute the task without guessing which similarly named work item is intended.',
      'Preserve uncertainty from the evidence and state any user approval boundary explicitly.',
      'Prefer tasks that can finish asynchronously without interrupting the user: gather evidence, analyze activity, summarize, compare, prioritize, or prepare a draft, checklist, report, or patch plan.',
      'Minimize clarification requests by making conservative assumptions and recording them in the result. Ask the user only when a consequential choice or new authorization is required.',
      'Do not perform external side effects by default. Email sends, deletion, unsubscribe, archive, label changes, GitHub comments, review submission, approval, merge, close, label, push, and X posting, replying, liking, reposting, following, or direct messaging require a later explicit user-approved action.',
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
  providers: Record<string, OnboardingTaskRecommendationProviderPromptConfig>;
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
      `Write every user-visible title, instruction, and reason in ${input.responseLanguage}. Preserve repository names, product names, people names, identifiers, and code tokens when translating them would reduce accuracy.`,
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
