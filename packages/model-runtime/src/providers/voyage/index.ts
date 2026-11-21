import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';
import { ModelProvider } from 'model-bank';
import type { ContextualizedEmbedResult, EmbedResponse } from 'voyageai';
import { VoyageAIClient, VoyageAIError } from 'voyageai';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import { withUsageCost } from '../../core/usageConverters/utils/withUsageCost';
import type { Embeddings, EmbeddingsOptions, EmbeddingsPayload } from '../../types';
import type { ILobeAgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { getModelPricing } from '../../utils/getModelPricing';
import { extractVoyageErrorDetail, resolveVoyageErrorType } from './errors';

const log = debug('lobe-model-runtime:voyage');

export const DEFAULT_VOYAGE_BASE_URL = 'https://api.voyageai.com/v1';

/** Inputs per request accepted by every Voyage embedding endpoint; larger calls are refused. */
export const VOYAGE_MAX_INPUTS_PER_REQUEST = 1000;

/**
 * Contextualized embeddings are always requested with auto-chunking: the API splits each
 * document into chunks of at most this many tokens (the documented maximum).
 * @see https://docs.voyageai.com/docs/contextualized-chunk-embeddings
 */
export const VOYAGE_CONTEXTUALIZED_CHUNK_SIZE = 32_000;

const MATRYOSHKA_DIMENSIONS = [256, 512, 1024, 2048] as const;
const FIXED_DIMENSIONS = [1024] as const;

interface VoyageEmbeddingModel {
  /** Contextualized models use `/contextualizedembeddings` instead of `/embeddings`. */
  contextualized: boolean;
  /** `output_dimension` values the model accepts. */
  dimensions: readonly number[];
}

/**
 * Every Voyage embedding model the runtime serves. There is no default: a model that is not
 * listed here is rejected before any request is sent. Keep in sync with `model-bank/voyage`.
 */
export const VOYAGE_EMBEDDING_MODELS: Record<string, VoyageEmbeddingModel> = {
  'voyage-3-large': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-3.5': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-3.5-lite': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-4': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-4-large': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-4-lite': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-code-3': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-code-4': { contextualized: false, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-context-3': { contextualized: true, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-context-4': { contextualized: true, dimensions: MATRYOSHKA_DIMENSIONS },
  'voyage-finance-2': { contextualized: false, dimensions: FIXED_DIMENSIONS },
  'voyage-law-2': { contextualized: false, dimensions: FIXED_DIMENSIONS },
};

export interface LobeVoyageAIParams {
  apiKey?: string;
  baseURL?: string | null;
  /** Provider id for pricing and error payloads; custom providers pass their own id. */
  id?: string;
}

/** A request the runtime refuses before sending, with the error type to report. */
class VoyageRequestError extends Error {
  constructor(
    message: string,
    readonly errorType: ILobeAgentRuntimeErrorType = AgentRuntimeErrorType.InvalidRequestFormat,
  ) {
    super(message);
  }
}

const trimTrailing = (value: string, char: string) => {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end--;
  return value.slice(0, end);
};

/**
 * Voyage embeddings only. The runtime implements `embeddings` alone, so chat, image and
 * other calls resolve to `undefined` through `ModelRuntime`.
 *
 * Plain models send `input` to `/embeddings` and return one vector per input. Contextualized
 * models send every input as one whole document to `/contextualizedembeddings` with
 * auto-chunking, and return the chunk vectors of all documents in order: that list can be
 * longer than `input`, and the chunk text the API reports is not returned.
 */
export class LobeVoyageAI implements LobeRuntimeAI {
  baseURL: string;
  private client: VoyageAIClient;
  private id: string;

  constructor({ apiKey, baseURL, id }: LobeVoyageAIParams = {}) {
    if (!apiKey?.trim())
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);

    this.baseURL = trimTrailing(baseURL?.trim() || DEFAULT_VOYAGE_BASE_URL, '/');
    this.id = id || ModelProvider.Voyage;
    this.client = new VoyageAIClient({ apiKey: apiKey.trim(), baseUrl: this.baseURL });
  }

  async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions): Promise<Embeddings[]> {
    try {
      const { definition, inputs, model, outputDimension } = this.resolveRequest(payload);
      const requestOptions = { abortSignal: options?.signal, headers: options?.headers };

      let vectors: Embeddings[];
      let totalTokens: number;

      if (definition.contextualized) {
        const result = await this.client.contextualizedEmbed(
          {
            chunkSize: VOYAGE_CONTEXTUALIZED_CHUNK_SIZE,
            enableAutoChunking: true,
            // Auto-chunking is only accepted for documents.
            inputType: 'document',
            inputs,
            model,
            outputDimension,
          },
          requestOptions,
        );
        vectors = this.readContextualizedVectors(result, inputs.length);
        // `result.totalTokens` turns a missing usage into 0, so read the raw response.
        totalTokens = this.readTotalTokens(result.rawResponse.usage);
      } else {
        const response = await this.client.embed(
          { input: inputs, model, outputDimension },
          requestOptions,
        );
        vectors = this.readVectors(response, inputs.length);
        totalTokens = this.readTotalTokens(response.usage);
      }

      log(
        'model %s: %d inputs, %d vectors, %d tokens',
        model,
        inputs.length,
        vectors.length,
        totalTokens,
      );

      await this.reportUsage(model, totalTokens, options);

      return vectors;
    } catch (error) {
      throw this.toRuntimeError(error);
    }
  }

  private resolveRequest(payload: EmbeddingsPayload) {
    const model = payload.model?.trim();

    if (!model) {
      throw new VoyageRequestError(
        'A Voyage embedding model is required: there is no default model, pass one explicitly.',
      );
    }

    const definition = VOYAGE_EMBEDDING_MODELS[model];

    if (!definition) {
      throw new VoyageRequestError(
        `"${model}" is not a Voyage embedding model. Supported models: ${Object.keys(VOYAGE_EMBEDDING_MODELS).join(', ')}.`,
        AgentRuntimeErrorType.ModelNotFound,
      );
    }

    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];

    if (inputs.length === 0) throw new VoyageRequestError('Embedding input must not be empty.');

    // One request per call: splitting here could leave charged batches unreported when a
    // later one fails, so an oversized call is refused before anything is billed.
    if (inputs.length > VOYAGE_MAX_INPUTS_PER_REQUEST) {
      throw new VoyageRequestError(
        `Voyage accepts at most ${VOYAGE_MAX_INPUTS_PER_REQUEST} inputs per request, got ${inputs.length}. Send smaller batches.`,
      );
    }

    if (inputs.some((item) => typeof item !== 'string' || item === '')) {
      throw new VoyageRequestError('Embedding input must be non-empty strings.');
    }

    let outputDimension: number | undefined;

    if (payload.dimensions !== undefined) {
      if (!definition.dimensions.includes(payload.dimensions)) {
        throw new VoyageRequestError(
          `${model} supports output dimensions ${definition.dimensions.join(', ')}, not ${payload.dimensions}.`,
        );
      }

      outputDimension = payload.dimensions;
    }

    return { definition, inputs, model, outputDimension };
  }

  private readVectors(response: EmbedResponse, expected: number): Embeddings[] {
    const items = [...(response.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = items.map((item) => item.embedding);

    if (vectors.length !== expected || vectors.some((vector) => !Array.isArray(vector))) {
      throw new VoyageRequestError(
        `Voyage returned ${vectors.length} embeddings for ${expected} inputs.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    return vectors as Embeddings[];
  }

  private readContextualizedVectors(
    result: ContextualizedEmbedResult,
    expectedDocuments: number,
  ): Embeddings[] {
    // The SDK numbers `results` by response position, so the API's order is kept as is.
    const documents = result.results;

    if (documents.length !== expectedDocuments) {
      throw new VoyageRequestError(
        `Voyage returned embeddings for ${documents.length} documents for ${expectedDocuments} inputs.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    return documents.flatMap((document) => {
      if (document.embeddings.length === 0 || document.embeddings.some((v) => v.length === 0)) {
        throw new VoyageRequestError(
          'Voyage returned a document without usable chunk embeddings.',
          AgentRuntimeErrorType.ProviderBizError,
        );
      }

      return document.embeddings;
    });
  }

  /** Billing fails closed: a response without a token count is an error, not a free call. */
  private readTotalTokens(usage: { totalTokens?: number } | undefined): number {
    const total = usage?.totalTokens;

    if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) {
      throw new VoyageRequestError(
        'Voyage did not report token usage for this request, so it cannot be billed.',
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    return total;
  }

  private async reportUsage(model: string, totalTokens: number, options?: EmbeddingsOptions) {
    if (!options?.onUsage) return;

    const pricing = await getModelPricing(model, this.id, options.pricingContext);

    if (!pricing) {
      throw new VoyageRequestError(
        `No pricing is configured for ${model}, so the request cannot be billed.`,
        AgentRuntimeErrorType.ProviderBizError,
      );
    }

    await options.onUsage(
      withUsageCost(
        { inputTextTokens: totalTokens, totalInputTokens: totalTokens, totalTokens },
        pricing,
      ),
    );
  }

  private toRuntimeError(error: unknown) {
    const endpoint = desensitizeUrl(this.baseURL);

    if (error instanceof VoyageRequestError) {
      return AgentRuntimeError.chat({
        endpoint,
        error: { message: error.message },
        errorType: error.errorType,
        provider: this.id,
      });
    }

    if (error instanceof VoyageAIError) {
      return AgentRuntimeError.chat({
        endpoint,
        error: {
          message: extractVoyageErrorDetail(error.body) ?? error.message,
          status: error.statusCode,
        },
        errorType: resolveVoyageErrorType(error.statusCode),
        provider: this.id,
      });
    }

    // Aborts and network failures: keep the message only, never the request object.
    const { message, name } = error as Error;

    return AgentRuntimeError.chat({
      endpoint,
      error: { message, name },
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: this.id,
    });
  }
}

export default LobeVoyageAI;
