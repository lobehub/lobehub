import type { OpenAIChatMessage } from '@lobechat/types';

/** Bump when the create-task intent recognition prompt meaningfully changes. */
export const TASK_INTENT_PROMPT_VERSION = 'v1';

/** How the user's request is best carried out. */
export const TASK_INTENT_KINDS = ['task', 'goal'] as const;

/** How sure the model is that it can hand the brief to an executor as-is. */
export const TASK_INTENT_CONFIDENCES = ['high', 'medium', 'low'] as const;

export const TASK_INTENT_JSON_SCHEMA = {
  name: 'task_intent',
  schema: {
    additionalProperties: false,
    properties: {
      clarifications: {
        items: {
          additionalProperties: false,
          properties: {
            /** Why the answer changes the work — shown under the question. */
            impact: { maxLength: 160, type: 'string' },
            /** Plausible answers offered as one-tap chips. May be empty. */
            options: { items: { maxLength: 60, type: 'string' }, maxItems: 4, type: 'array' },
            question: { maxLength: 120, minLength: 1, type: 'string' },
          },
          required: ['question', 'impact', 'options'],
          type: 'object',
        },
        maxItems: 3,
        type: 'array',
      },
      confidence: { enum: [...TASK_INTENT_CONFIDENCES], type: 'string' },
      kind: { enum: [...TASK_INTENT_KINDS], type: 'string' },
      kindReason: { maxLength: 160, type: 'string' },
      refinedInstruction: { minLength: 1, type: 'string' },
      summary: { maxLength: 200, minLength: 1, type: 'string' },
      title: { maxLength: 80, minLength: 1, type: 'string' },
    },
    required: [
      'title',
      'summary',
      'refinedInstruction',
      'kind',
      'kindReason',
      'confidence',
      'clarifications',
    ],
    type: 'object' as const,
  },
  strict: true,
};

interface TaskIntentInput {
  /** Free-form surrounding context: the agent it is assigned to, the project. */
  context?: string;
  /** Raw text the user typed into the task composer. */
  instruction: string;
}

/**
 * Read what the user typed into the task composer and report what they meant.
 *
 * The caller decides what to do with the answer: a confident, unambiguous
 * reading is created straight through with a better title, and anything else
 * stops for the user to confirm. So the prompt's job is to be *honest* about
 * ambiguity rather than agreeable — an invented assumption costs a whole
 * wasted autonomous run, while an unnecessary question costs one click.
 */
export const chainTaskIntent = ({
  context,
  instruction,
}: TaskIntentInput): { messages: OpenAIChatMessage[] } => ({
  messages: [
    {
      content: [
        'You read a task request a user just typed into a task composer and report what they actually want, before any agent starts working on it.',
        '',
        'Return:',
        '- title: a short, specific task name in the imperative. Never a truncation of the request, never a restatement of the whole sentence.',
        '- summary: one sentence, addressed to the user, stating the outcome you understood they want. This is what they check before approving.',
        '- refinedInstruction: the request rewritten as a complete brief for an autonomous executor. Preserve every URL, identifier, file path, number, threshold, and named constraint from the original exactly. Never add scope, deliverables, or quality bars the user did not ask for.',
        '- kind: "goal" when the request is a standing outcome pursued over many autonomous rounds against a durable acceptance bar (keep something at a level, drive a metric, iterate until reviewed and accepted). "task" when a single execution can deliver it. When in doubt, "task" — a goal commits the user to a budget of autonomous rounds.',
        "- kindReason: one sentence justifying the kind, in the user's language.",
        '- confidence: "high" ONLY when the request already names a concrete deliverable AND a concrete target to act on. A short request that names an intent without a deliverable ("improve the homepage", "clean up the feedback", "make it faster") is never high — you cannot tell what would be handed back.',
        '- confidence: "medium" when the deliverable or the target is implied but recoverable from the wording; "low" when the request could reasonably produce materially different deliverables.',
        '- clarifications: the questions whose answers change what gets delivered.',
        '',
        'Rules for clarifications:',
        '- Ask nothing when the request is already actionable. Zero questions is the expected outcome for a well-written request, and confidence "high" must come with an empty list.',
        '- But a vague request is NOT an actionable one. Before deciding to ask nothing, name the deliverable you would hand back and the exact thing you would act on. If you cannot name both from the request itself, you must ask — silence on a request like "improve the homepage" or "organize the feedback" sends an agent off to produce something the user never asked for.',
        '- At most 3, ordered by how much the answer changes the work.',
        '- Only ask when different answers lead to materially different deliverables. Never ask about implementation choices the executor should make ("which library", "which approach", "how should it be built"), about preferences that do not change the outcome, or about anything already stated in the request. The executor is a capable engineer: it picks the how, the user owns the what.',
        '- Never ask the user to restate their request or to "provide more detail" in general.',
        '- impact states what changes depending on the answer, concretely.',
        '- options lists plausible concrete answers when they are enumerable, so the user can answer with one tap. Use [] when the answer is open-ended.',
        '',
        'Write EVERY human-facing field — title, summary, kindReason, and every question, impact, and option — in the language the user wrote in. A single field in another language is a defect.',
      ].join('\n'),
      role: 'system',
    },
    {
      content: [`## Request\n${instruction}`, context ? `\n## Context\n${context}` : '']
        .filter(Boolean)
        .join('\n'),
      role: 'user',
    },
  ],
});
