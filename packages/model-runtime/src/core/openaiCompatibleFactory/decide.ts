import type { ModelUsage } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import createDebug from 'debug';
import type OpenAI from 'openai';
import { z } from 'zod';

import type {
  DecisionAnswer,
  DecisionOptions,
  DecisionPayload,
  DecisionQuestion,
  DecisionResponse,
} from '../../types';
import { AgentRuntimeError } from '../../utils/createError';
import { getModelPricing } from '../../utils/getModelPricing';
import type { ModelIdMappingOptions } from '../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../utils/modelIdMapping';
import { withUsageCost } from '../usageConverters/utils/withUsageCost';

const log = createDebug('lobe-model-runtime:decide');

/**
 * System One wire format, shared by TypeSafe and OpenRouter.
 * @see https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request
 */
const SystemOneAnswerSchema = z.discriminatedUnion('type', [
  z.object({ noul: z.number().min(0).max(1), type: z.literal('noul') }),
  z.object({
    choice: z.string(),
    confidence: z.number().optional(),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
    type: z.literal('choice'),
  }),
  z.object({
    confidence: z.number().optional(),
    /** Level index (as a string key) → probability. */
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
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
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

type SystemOneAnswer = z.infer<typeof SystemOneAnswerSchema>;

const toSystemOneQuestion = (question: DecisionQuestion) =>
  question.type === 'predicate' ? { ...question, type: 'noul' as const } : question;

class InvalidDecisionResponseError extends Error {}

const toDecisionAnswer = (
  name: string,
  question: DecisionQuestion,
  answer: SystemOneAnswer | undefined,
): DecisionAnswer => {
  if (!answer) throw new InvalidDecisionResponseError(`Missing answer for question "${name}"`);
  if (answer.type === 'refusal') return { reason: answer.reason, type: 'refusal' };

  if (question.type === 'predicate' && answer.type === 'noul') {
    return { probability: answer.noul, type: 'predicate' };
  }

  if (question.type === 'choice' && answer.type === 'choice') {
    if (!Object.hasOwn(question.criteria, answer.choice)) {
      throw new InvalidDecisionResponseError(
        `Question "${name}" chose "${answer.choice}", which is not a requested option`,
      );
    }
    // Like score levels below: callers threshold on every option, so a gap is not a zero.
    const probabilities = Object.fromEntries(
      Object.keys(question.criteria).map((option) => {
        // Own keys only: option names such as `toString` would otherwise hit the prototype.
        if (!Object.hasOwn(answer.probabilities, option)) {
          throw new InvalidDecisionResponseError(
            `Question "${name}" has no probability for option "${option}"`,
          );
        }
        return [option, answer.probabilities[option]];
      }),
    );
    return { choice: answer.choice, confidence: answer.confidence, probabilities, type: 'choice' };
  }

  if (question.type === 'score' && answer.type === 'score') {
    // A missing level probability is not evidence of zero, so reject rather than fill it.
    const probabilities = question.criteria.map((_, level) => {
      const probability = answer.probabilities[String(level)];
      if (probability === undefined) {
        throw new InvalidDecisionResponseError(
          `Question "${name}" has no probability for score level ${level}`,
        );
      }
      return probability;
    });
    return { confidence: answer.confidence, probabilities, score: answer.score, type: 'score' };
  }

  throw new InvalidDecisionResponseError(
    `Question "${name}" is a ${question.type} question but got a ${answer.type} answer`,
  );
};

/**
 * Serves decision models through a System One endpoint. Only providers that set this expose
 * `decide`, so callers can tell decision support apart from plain chat compatibility.
 */
export interface SystemOneDecideConfig {
  /** Endpoint path relative to the client base URL, e.g. `/systemone`. */
  path: string;
}

interface RequestSystemOneDecisionParams extends SystemOneDecideConfig {
  provider: string;
  /** Model id sent upstream; may differ from `payload.model` after id mapping. */
  requestModel: string;
}

const requestSystemOneDecision = async (
  client: OpenAI,
  payload: DecisionPayload,
  options: DecisionOptions | undefined,
  { path, provider, requestModel }: RequestSystemOneDecisionParams,
): Promise<DecisionResponse> => {
  const questionEntries = Object.entries(payload.questions);
  if (questionEntries.length === 0) {
    throw AgentRuntimeError.chat({
      error: { message: 'A decision request needs at least one question' },
      errorType: AgentRuntimeErrorType.InvalidRequestFormat,
      provider,
    });
  }

  log('decide model=%s questions=%d', requestModel, questionEntries.length);

  const raw = await client.post(path, {
    body: {
      model: requestModel,
      questions: Object.fromEntries(
        questionEntries.map(([name, question]) => [name, toSystemOneQuestion(question)]),
      ),
      state: payload.state,
      ...(options?.user && { user: options.user }),
    },
    headers: options?.headers,
    // Callers own retry policy: a decision is often one arm of a timed experiment, and hidden
    // SDK retries would multiply latency and spend without the caller seeing the attempts.
    maxRetries: 0,
    signal: options?.signal,
  });

  const parsed = SystemOneResponseSchema.safeParse(raw);
  let response: DecisionResponse;
  try {
    if (!parsed.success) throw new InvalidDecisionResponseError(parsed.error.message);

    response = {
      answers: Object.fromEntries(
        questionEntries.map(([name, question]) => [
          name,
          toDecisionAnswer(name, question, parsed.data.answers[name]),
        ]),
      ),
      id: parsed.data.id,
      model: parsed.data.model,
      provider: parsed.data.provider,
    };
  } catch (error) {
    if (!(error instanceof InvalidDecisionResponseError)) throw error;
    throw AgentRuntimeError.chat({
      error: { message: `Invalid decision response: ${error.message}` },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider,
    });
  }

  const usage = parsed.data.usage;
  if (options?.onUsage && usage) {
    const outputTokens = usage.output_tokens ?? 0;
    const tokens = {
      inputTextTokens: usage.input_tokens,
      // Decision models bill input only, but report output tokens anyway (Jev returns non-zero
      // counts). Keep them for observability; cost comes from the model's pricing units.
      outputTextTokens: outputTokens,
      totalInputTokens: usage.input_tokens,
      totalOutputTokens: outputTokens,
      totalTokens: usage.input_tokens + outputTokens,
    } satisfies ModelUsage;
    const pricing = await getModelPricing(payload.model, provider, options.pricingContext);
    await options.onUsage(withUsageCost(tokens, pricing));
  }

  return response;
};

interface CreateSystemOneDecisionParams extends SystemOneDecideConfig {
  /** Maps transport failures (HTTP, network) to the provider's runtime error payload. */
  handleError: (error: unknown) => unknown;
  modelIdMappingOptions?: ModelIdMappingOptions;
  provider: string;
}

export const createSystemOneDecision = async (
  client: OpenAI,
  payload: DecisionPayload,
  options: DecisionOptions | undefined,
  { handleError, modelIdMappingOptions, ...params }: CreateSystemOneDecisionParams,
): Promise<DecisionResponse> => {
  try {
    return await requestSystemOneDecision(client, payload, options, {
      ...params,
      requestModel: resolveMappedModelId(payload.model, modelIdMappingOptions),
    });
  } catch (error) {
    // Validation failures are already runtime error payloads; only map transport errors.
    if (isRecord(error) && 'errorType' in error) throw error;
    throw handleError(error);
  }
};
