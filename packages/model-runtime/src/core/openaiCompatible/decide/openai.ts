import { z } from 'zod';

import type { DecisionAnswer, DecisionContent, DecisionQuestion } from '../../../types';
import type { DecisionWireAdapter } from './shared';
import {
  assertRequestedChoice,
  InvalidDecisionResponseError,
  pickChoiceProbabilities,
  pickScoreProbabilities,
} from './shared';

/**
 * OpenAI Decisions API wire format (`POST /v1/decisions`). Questions are an ordered array of
 * named `predicate` / `choice` / `score` items and answers come back in the same order.
 * Field shapes follow the `openai` SDK `resources/decisions` types (v7.30+).
 * @see https://developers.openai.com/api/docs/guides/decisions
 */
const ProbabilitySchema = z.number().min(0).max(1);

const OpenAIDecisionAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().nullable(),
    probability: ProbabilitySchema,
    type: z.literal('predicate'),
  }),
  z.object({
    /** Choice values are typed upstream; we only send strings, so a boolean never matches. */
    choice: z.union([z.string(), z.boolean()]),
    confidence: z.number().optional(),
    name: z.string().nullable(),
    probabilities: z
      .array(
        z.object({ probability: ProbabilitySchema, value: z.union([z.string(), z.boolean()]) }),
      )
      .optional(),
    type: z.literal('choice'),
  }),
  z.object({
    confidence: z.number().optional(),
    name: z.string().nullable(),
    probabilities: z
      .array(
        z.object({
          label: z.string().optional(),
          probability: ProbabilitySchema,
          /** Zero-based level index. */
          value: z.number().int().nonnegative(),
        }),
      )
      .optional(),
    score: z.number(),
    type: z.literal('score'),
  }),
  // A refusal carries only the question name; `name` is null for unnamed questions.
  z.object({ name: z.string().nullable(), type: z.literal('refusal') }).passthrough(),
]);

const OpenAIDecisionResponseSchema = z.object({
  answers: z.array(OpenAIDecisionAnswerSchema),
  id: z.string().optional(),
  model: z.string(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

type OpenAIDecisionAnswer = z.infer<typeof OpenAIDecisionAnswerSchema>;

/** OpenAI accepts only strings for `input`, `instructions`, and option descriptions. */
const toText = (content: DecisionContent): string =>
  typeof content === 'string' ? content : JSON.stringify(content);

/**
 * `predicate` questions have no criteria field, so the true/false guidance goes into the
 * instructions the model reads.
 */
const toPredicateInstructions = (
  question: Extract<DecisionQuestion, { type: 'boolean' }>,
): string => {
  const instructions = toText(question.instructions);
  if (!question.criteria) return instructions;

  return [
    instructions,
    `True when: ${toText(question.criteria.true)}`,
    `False when: ${toText(question.criteria.false)}`,
  ].join('\n\n');
};

const toOpenAIQuestion = (name: string, question: DecisionQuestion) => {
  switch (question.type) {
    case 'boolean': {
      return { instructions: toPredicateInstructions(question), name, type: 'predicate' };
    }

    case 'choice': {
      return {
        choices: Object.entries(question.criteria).map(([value, description]) => ({
          ...(description !== null && { description: toText(description) }),
          value,
        })),
        instructions: toText(question.instructions),
        name,
        type: 'choice',
      };
    }

    case 'score': {
      return {
        instructions: toText(question.instructions),
        // `label` is required upstream; our rubric has descriptions only, so label by index,
        // which is also the value the response reports per level.
        levels: question.criteria.map((criterion, level) => ({
          description: toText(criterion),
          label: String(level),
        })),
        name,
        type: 'score',
      };
    }
  }
};

const toDecisionAnswer = (
  name: string,
  question: DecisionQuestion,
  answer: OpenAIDecisionAnswer | undefined,
): DecisionAnswer => {
  if (!answer) throw new InvalidDecisionResponseError(`Missing answer for question "${name}"`);
  // Answers are positional; a reported name must still match so a reordered response is caught.
  if (answer.name !== null && answer.name !== name) {
    throw new InvalidDecisionResponseError(
      `Expected the answer to question "${name}" but got "${answer.name}"`,
    );
  }
  if (answer.type === 'refusal') return { type: 'refusal' };

  if (question.type === 'boolean' && answer.type === 'predicate') {
    return { probability: answer.probability, type: 'boolean' };
  }

  if (question.type === 'choice' && answer.type === 'choice') {
    const choice = assertRequestedChoice(name, question, answer.choice);
    const reported = answer.probabilities;
    const probabilities =
      reported &&
      pickChoiceProbabilities(
        name,
        question,
        (option) => reported.find((entry) => entry.value === option)?.probability,
      );
    return { choice, confidence: answer.confidence, probabilities, type: 'choice' };
  }

  if (question.type === 'score' && answer.type === 'score') {
    const reported = answer.probabilities;
    const probabilities =
      reported &&
      pickScoreProbabilities(
        name,
        question,
        (level) => reported.find((entry) => entry.value === level)?.probability,
      );
    return { confidence: answer.confidence, probabilities, score: answer.score, type: 'score' };
  }

  throw new InvalidDecisionResponseError(
    `Question "${name}" is a ${question.type} question but got a ${answer.type} answer`,
  );
};

export const openaiDecisionAdapter: DecisionWireAdapter = {
  buildBody: ({ payload, questionEntries, requestModel, user }) => ({
    input: toText(payload.state),
    model: requestModel,
    questions: questionEntries.map(([name, question]) => toOpenAIQuestion(name, question)),
    // The Decisions API takes `safety_identifier` (like Responses) rather than `user`.
    ...(user && { safety_identifier: user }),
  }),

  parseResponse: (raw, questionEntries) => {
    const parsed = OpenAIDecisionResponseSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidDecisionResponseError(parsed.error.message);

    const { answers, id, model, usage } = parsed.data;
    if (answers.length !== questionEntries.length) {
      throw new InvalidDecisionResponseError(
        `Expected ${questionEntries.length} answers but got ${answers.length}`,
      );
    }

    return {
      response: {
        answers: Object.fromEntries(
          questionEntries.map(([name, question], index) => [
            name,
            toDecisionAnswer(name, question, answers[index]),
          ]),
        ),
        id,
        model,
      },
      // OpenAI reports no charge; cost comes from the model card's input-only pricing.
      usage: usage && { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
    };
  },
};
