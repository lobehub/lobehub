import { z } from 'zod';

import type { DecisionAnswer, DecisionQuestion } from '../../../types';
import type { DecisionWireAdapter } from './shared';
import {
  assertRequestedChoice,
  InvalidDecisionResponseError,
  pickChoiceProbabilities,
  pickScoreProbabilities,
} from './shared';

/**
 * System One wire format, shared by TypeSafe and OpenRouter.
 * @see https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request
 */
const SystemOneAnswerSchema = z.discriminatedUnion('type', [
  z.object({ noul: z.number().min(0).max(1), type: z.literal('noul') }),
  z.object({
    choice: z.string(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
    type: z.literal('choice'),
  }),
  z.object({
    confidence: z.number().optional(),
    /** Level index (as a string key) → probability. */
    probabilities: z.record(z.string(), z.number().min(0).max(1)).optional(),
    score: z.number(),
    type: z.literal('score'),
  }),
  // The refusal payload is undocumented; keep whatever text the provider sends.
  z.object({ reason: z.string().optional(), type: z.literal('refusal') }).passthrough(),
]);

const SystemOneResponseSchema = z.object({
  answers: z.record(z.string(), SystemOneAnswerSchema),
  id: z.string().optional(),
  model: z.string(),
  provider: z.string().optional(),
  usage: z
    .object({
      /**
       * USD charge OpenRouter reports for the call. Kept loose so an unusable value is dropped
       * like chat's provider-reported cost instead of failing an otherwise valid decision.
       */
      cost: z.unknown().optional(),
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

type SystemOneAnswer = z.infer<typeof SystemOneAnswerSchema>;

const toSystemOneQuestion = (question: DecisionQuestion) =>
  question.type === 'boolean' ? { ...question, type: 'noul' as const } : question;

const toDecisionAnswer = (
  name: string,
  question: DecisionQuestion,
  answer: SystemOneAnswer | undefined,
): DecisionAnswer => {
  if (!answer) throw new InvalidDecisionResponseError(`Missing answer for question "${name}"`);
  if (answer.type === 'refusal') return { reason: answer.reason, type: 'refusal' };

  if (question.type === 'boolean' && answer.type === 'noul') {
    return { probability: answer.noul, type: 'boolean' };
  }

  if (question.type === 'choice' && answer.type === 'choice') {
    const choice = assertRequestedChoice(name, question, answer.choice);
    const reported = answer.probabilities;
    const probabilities =
      reported &&
      pickChoiceProbabilities(name, question, (option) =>
        Object.hasOwn(reported, option) ? reported[option] : undefined,
      );
    return { choice, confidence: answer.confidence, probabilities, type: 'choice' };
  }

  if (question.type === 'score' && answer.type === 'score') {
    const reported = answer.probabilities;
    const probabilities =
      reported && pickScoreProbabilities(name, question, (level) => reported[String(level)]);
    return { confidence: answer.confidence, probabilities, score: answer.score, type: 'score' };
  }

  throw new InvalidDecisionResponseError(
    `Question "${name}" is a ${question.type} question but got a ${answer.type} answer`,
  );
};

export const systemOneDecisionAdapter: DecisionWireAdapter = {
  buildBody: ({ payload, questionEntries, requestModel, user }) => ({
    model: requestModel,
    questions: Object.fromEntries(
      questionEntries.map(([name, question]) => [name, toSystemOneQuestion(question)]),
    ),
    state: payload.state,
    ...(user && { user }),
  }),

  parseResponse: (raw, questionEntries) => {
    const parsed = SystemOneResponseSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidDecisionResponseError(parsed.error.message);

    const { answers, id, model, provider, usage } = parsed.data;
    return {
      response: {
        answers: Object.fromEntries(
          questionEntries.map(([name, question]) => [
            name,
            toDecisionAnswer(name, question, answers[name]),
          ]),
        ),
        id,
        model,
        provider,
      },
      usage: usage && {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        providerReportedCost: usage.cost,
      },
    };
  },
};
