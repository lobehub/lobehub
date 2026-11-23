import type { OpenAIChatMessage } from '@lobechat/types';

/** Bump when the eval criteria drafting prompt or its output contract changes. */
export const EVAL_CRITERIA_DRAFT_PROMPT_VERSION = 'v1';

export const EVAL_CRITERIA_DRAFT_JSON_SCHEMA = {
  name: 'eval_criteria_draft',
  schema: {
    additionalProperties: false,
    properties: {
      /** Self-contained pass/fail standard the judge scores replays against. */
      criteria: { minLength: 1, type: 'string' },
      /** What a correct answer looks like, or an empty string when there is no single one. */
      expected: { type: 'string' },
      /** One sentence naming what went wrong (or right) in the captured answer. */
      summary: { maxLength: 200, minLength: 1, type: 'string' },
    },
    required: ['criteria', 'expected', 'summary'],
    type: 'object' as const,
  },
  strict: true,
};

export interface EvalCriteriaDraftTurn {
  content: string;
  role: string;
}

export interface EvalCriteriaDraftInput {
  /** The answer being captured. */
  capturedOutput: string;
  /** Whether the captured answer is the bad case or an answer worth keeping. */
  capturedOutputKind: 'negative' | 'positive';
  /** Conversation the answer was given in, oldest first, ending with the user turn it answered. */
  conversation: EvalCriteriaDraftTurn[];
  /** Locale to write the criteria in, e.g. `zh-CN`. */
  locale?: string;
  /** What the user said is wrong (or right) about it, when they said anything. */
  note?: string;
}

/**
 * Draft the pass/fail standard for a test case frozen out of a conversation.
 *
 * The judge that later scores replays sees only the criteria, the last user
 * input, the replayed answer and `expected` — never the conversation this
 * prompt reads. So the draft's whole job is to carry every background fact a
 * verdict depends on into the criteria text itself.
 */
export const chainEvalCriteriaDraft = ({
  capturedOutput,
  capturedOutputKind,
  conversation,
  locale,
  note,
}: EvalCriteriaDraftInput): { messages: OpenAIChatMessage[] } => {
  const transcript = conversation
    .map((turn) => `[${turn.role.toUpperCase()}]\n${turn.content}`)
    .join('\n\n');

  return {
    messages: [
      {
        content: [
          'You turn one assistant answer from a real conversation into a regression test case for an LLM evaluation suite.',
          '',
          'The test case will be replayed against other models. A separate judge model then scores each replayed answer. That judge sees ONLY four things:',
          '1. the criteria you write,',
          '2. the last user message (the case input),',
          '3. the replayed answer,',
          '4. the expected answer you write.',
          'It never sees the system prompt, the earlier turns, the user profile, tool results or anything else from the conversation.',
          '',
          'Write:',
          '- criteria: a self-contained pass/fail standard. First state, as plain facts, every piece of background the verdict depends on (who the user is, who other people mentioned are, what was asked earlier, constraints from the system prompt or tool results). Then list what a passing answer must do and what makes it fail, concretely enough that two judges would agree. Never refer to "the conversation", "above", "earlier" or "the context" — restate the fact instead.',
          '- expected: a short description or example of a correct answer. Use an empty string when many different answers would be correct.',
          '- summary: one sentence naming what the captured answer got wrong (or right).',
          '',
          capturedOutputKind === 'negative'
            ? 'The captured answer is a BAD case: the criteria must make that answer fail and a correct answer pass.'
            : 'The captured answer is a GOOD example: the criteria must make that answer pass.',
          `Write criteria, expected and summary in ${locale || 'the language the user wrote in'}.`,
        ].join('\n'),
        role: 'system',
      },
      {
        content: [
          '<conversation>',
          transcript || '(empty)',
          '</conversation>',
          '',
          '<captured_answer>',
          capturedOutput || '(empty)',
          '</captured_answer>',
          ...(note?.trim() ? ['', '<user_note>', note.trim(), '</user_note>'] : []),
        ].join('\n'),
        role: 'user',
      },
    ],
  };
};
