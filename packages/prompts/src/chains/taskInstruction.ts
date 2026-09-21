import type { OpenAIChatMessage } from '@lobechat/types';

/** Bump when the confirmed-instruction synthesis prompt meaningfully changes. */
export const TASK_INSTRUCTION_PROMPT_VERSION = 'v1';

export const TASK_INSTRUCTION_JSON_SCHEMA = {
  name: 'task_instruction',
  schema: {
    additionalProperties: false,
    properties: {
      instruction: { minLength: 1, type: 'string' },
      title: { maxLength: 80, minLength: 1, type: 'string' },
    },
    required: ['instruction', 'title'],
    type: 'object' as const,
  },
  strict: true,
};

interface TaskInstructionInput {
  /** Question/answer pairs the user settled on the review step. */
  answers: { answer: string; question: string }[];
  /** Free-form surrounding context: the agent it is assigned to, the project. */
  context?: string;
  /** The draft exactly as the user typed it. */
  instruction: string;
}

/**
 * Rewrite a confirmed draft into the single brief an executor will actually run.
 *
 * The reading that produced the questions was written *before* the user
 * answered them, so it still names those gaps as open ("pending the delivery
 * format…"). Concatenating the answers underneath it leaves a brief that
 * contradicts itself — the body says a detail is missing while an appendix
 * below states it. This pass exists to resolve that: the answers are settled
 * facts now, and the brief has to read as though they always were.
 *
 * It is also the whole handover: the executor sees this text and nothing else,
 * so the brief has to carry the deliverable, the inputs, and every settled
 * constraint rather than restate the request in a sentence.
 *
 * It rewrites, so the hard limit is that it may not invent. Every URL,
 * identifier, path, number and named constraint has to survive verbatim, and
 * nothing the user did not ask for may appear — completeness means making the
 * request actionable, never adding to it.
 */
export const chainTaskInstruction = ({
  answers,
  context,
  instruction,
}: TaskInstructionInput): { messages: OpenAIChatMessage[] } => ({
  messages: [
    {
      content: [
        'You write the final brief for an autonomous executor, from a task request and the answers the user just gave to your clarifying questions.',
        '',
        'This brief is the whole handover. The executor never sees the request, the questions, or this conversation — it sees only what you write, so anything it needs that is missing here is simply lost. Write the full working brief, not a one-line restatement of the request.',
        '',
        'Return:',
        '- instruction: a complete brief in markdown, structured as:',
        '  1. an opening paragraph stating the outcome — what is being produced and from what. Do not name an audience, a purpose or a business goal the user did not state;',
        "  2. a requirements section under a markdown heading, its title written in the user's language, listing every settled requirement as its own bullet: the deliverable and its format, the sources or inputs to work from, the dimensions or metrics to cover, and every constraint the user stated or answered;",
        '  3. a closing note naming what is deliberately left to the executor, phrased as latitude — only when the user actually left something open.',
        '- title: a short, specific task name in the imperative, consistent with the brief.',
        '',
        'Rules:',
        '- Fold every answer into the brief as a settled fact. Never append a question-and-answer list, never restate a question, and never describe anything the user answered as missing, pending, or to be confirmed.',
        '- Preserve every URL, identifier, file path, number, threshold, and named constraint from the request exactly as written.',
        '- Completeness is about making the request fully actionable, never about adding to it. Every requirement you list must trace to something the user wrote or answered — no invented deliverables, scope, quality bars, deadlines, or tools.',
        '- A question the user skipped stays genuinely open: name it as the executor\'s call, in the wording of latitude rather than of a blocker — "decide this yourself based on what you find", never "pending X before starting". Never answer it on the user\'s behalf.',
        '- Write it in the language the user wrote in.',
      ].join('\n'),
      role: 'system',
    },
    {
      content: [
        `## Request\n${instruction}`,
        answers.length > 0
          ? `\n## Answers\n${answers.map(({ answer, question }) => `- ${question} → ${answer}`).join('\n')}`
          : '',
        context ? `\n## Context\n${context}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      role: 'user',
    },
  ],
});
