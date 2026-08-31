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
 * It rewrites, so the hard limit is that it may not invent. Every URL,
 * identifier, path, number and named constraint has to survive verbatim, and
 * nothing the user did not ask for may appear.
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
        'Return:',
        '- instruction: one coherent brief. Fold every answer into the body as a settled fact. Never append a question-and-answer list, never restate a question, and never describe anything the user answered as missing, pending, or to be confirmed.',
        '- title: a short, specific task name in the imperative, consistent with the brief.',
        '',
        'Rules:',
        '- Preserve every URL, identifier, file path, number, threshold, and named constraint from the request exactly as written.',
        '- Add nothing the user did not ask for: no extra deliverables, no scope, no quality bars, no deadlines, no assumptions in place of an answer.',
        '- A question the user skipped stays genuinely open. Do not invent an answer for it, and do not turn it into a constraint — leave the executor the same latitude the user left it.',
        '- Keep the brief as short as the work allows. It is an instruction to act on, not a summary of the conversation that produced it.',
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
