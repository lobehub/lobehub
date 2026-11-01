import type { ModelUsage } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { isRecord } from '../../../utils/object';
import createDebug from 'debug';
import { DECISION_MODEL_SUFFIX } from 'model-bank';
import type OpenAI from 'openai';

import type {
  DecisionOptions,
  DecisionPayload,
  DecisionQuestions,
  DecisionResponse,
} from '../../../types';
import { AgentRuntimeError } from '../../../utils/createError';
import { getModelPricing } from '../../../utils/getModelPricing';
import type { ModelIdMappingOptions } from '../../../utils/modelIdMapping';
import { resolveMappedModelId } from '../../../utils/modelIdMapping';
import { withUsageCost } from '../../usageConverters/utils/withUsageCost';
import { openaiDecisionAdapter } from './openai';
import type { DecisionWireAdapter } from './shared';
import { InvalidDecisionResponseError } from './shared';
import { systemOneDecisionAdapter } from './systemOne';

const log = createDebug('lobe-model-runtime:decide');

const adapters = {
  openai: openaiDecisionAdapter,
  systemone: systemOneDecisionAdapter,
} satisfies Record<string, DecisionWireAdapter>;

/**
 * Serves decision models through a dedicated endpoint. Only providers that set this expose
 * `decide`, so callers can tell decision support apart from plain chat compatibility.
 */
export interface DecideConfig {
  /** Whether the provider accepts the optional request user identifier. Defaults to true. */
  includeUser?: boolean;
  /** Endpoint path relative to the client base URL, e.g. `/systemone` or `/decisions`. */
  path: string;
  /**
   * Wire format of the endpoint: `systemone` for TypeSafe / OpenRouter System One, `openai`
   * for the OpenAI Decisions API.
   */
  protocol: keyof typeof adapters;
}

const toProviderReportedCost = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/**
 * `<id>:decision` only keeps a decision card apart from the chat card with the same upstream id
 * (see `DECISION_MODEL_WHITELIST`); upstream never knows the suffix.
 */
const toUpstreamModelId = (model: string) =>
  model.endsWith(DECISION_MODEL_SUFFIX) ? model.slice(0, -DECISION_MODEL_SUFFIX.length) : model;

interface RequestDecisionParams extends DecideConfig {
  provider: string;
  /** Model id sent upstream; may differ from `payload.model` after id mapping. */
  requestModel: string;
}

const requestDecision = async <Q extends DecisionQuestions>(
  client: OpenAI,
  payload: DecisionPayload<Q>,
  options: DecisionOptions | undefined,
  { includeUser = true, path, protocol, provider, requestModel }: RequestDecisionParams,
): Promise<DecisionResponse<Q>> => {
  const adapter = adapters[protocol];
  const questionEntries = Object.entries(payload.questions);
  if (questionEntries.length === 0) {
    throw AgentRuntimeError.chat({
      error: { message: 'A decision request needs at least one question' },
      errorType: AgentRuntimeErrorType.InvalidRequestFormat,
      provider,
    });
  }

  log('decide protocol=%s model=%s questions=%d', protocol, requestModel, questionEntries.length);

  const raw = await client.post(path, {
    body: adapter.buildBody({
      payload,
      questionEntries,
      requestModel,
      user: includeUser ? options?.user : undefined,
    }),
    headers: options?.headers,
    // Callers own retry policy: a decision is often one arm of a timed experiment, and hidden
    // SDK retries would multiply latency and spend without the caller seeing the attempts.
    maxRetries: 0,
    signal: options?.signal,
  });

  let parsed: ReturnType<DecisionWireAdapter['parseResponse']>;
  try {
    parsed = adapter.parseResponse(raw, questionEntries);
  } catch (error) {
    if (!(error instanceof InvalidDecisionResponseError)) throw error;
    throw AgentRuntimeError.chat({
      error: { message: `Invalid decision response: ${error.message}` },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider,
    });
  }

  // The adapters validate every requested name and answer type at runtime. Object.entries erases
  // the payload's mapped-key relationship, so restore it only after that validation boundary.
  const response = parsed.response as DecisionResponse<Q>;
  const usage = parsed.usage;
  if (usage) {
    const outputTokens = usage.outputTokens ?? 0;
    const tokens = {
      inputTextTokens: usage.inputTokens,
      // Decision models bill input only, but report output tokens anyway (Jev returns non-zero
      // counts). Keep them for observability; cost comes from the model's pricing units.
      outputTextTokens: outputTokens,
      totalInputTokens: usage.inputTokens,
      totalOutputTokens: outputTokens,
      totalTokens: usage.inputTokens + outputTokens,
    } satisfies ModelUsage;
    const pricing = await getModelPricing(payload.model, provider, options?.pricingContext);
    response.usage = withUsageCost(tokens, pricing);
    await options?.onUsage?.(response.usage);

    const providerReportedCost = toProviderReportedCost(usage.providerReportedCost);
    if (providerReportedCost !== undefined) {
      await options?.onProviderReportedCost?.(providerReportedCost);
    }
  }

  return response;
};

interface CreateDecisionParams extends DecideConfig {
  /** Maps transport failures (HTTP, network) to the provider's runtime error payload. */
  handleError: (error: unknown) => unknown;
  modelIdMappingOptions?: ModelIdMappingOptions;
  provider: string;
}

export const createDecision = async <Q extends DecisionQuestions>(
  client: OpenAI,
  payload: DecisionPayload<Q>,
  options: DecisionOptions | undefined,
  { handleError, modelIdMappingOptions, ...params }: CreateDecisionParams,
): Promise<DecisionResponse<Q>> => {
  try {
    return await requestDecision(client, payload, options, {
      ...params,
      requestModel: toUpstreamModelId(resolveMappedModelId(payload.model, modelIdMappingOptions)),
    });
  } catch (error) {
    // Validation failures are already runtime error payloads; only map transport errors.
    if (isRecord(error) && 'errorType' in error) throw error;
    throw handleError(error);
  }
};
