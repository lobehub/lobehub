// @vitest-environment node
import { AgentRuntimeErrorType } from '@lobechat/types';
import { voyage as voyageModels } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { providerRuntimeMap } from '../../runtimeMap';
import { extractVoyageErrorDetail } from './errors';
import {
  LobeVoyageAI,
  VOYAGE_CONTEXTUALIZED_CHUNK_SIZE,
  VOYAGE_EMBEDDING_MODELS,
  VOYAGE_MAX_INPUTS_PER_REQUEST,
} from './index';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const embedResponse = (count: number, totalTokens: number | null = 5) => ({
  data: Array.from({ length: count }, (_, index) => ({
    embedding: [index, 0.5],
    index,
    object: 'embedding',
  })),
  model: 'voyage-4-lite',
  object: 'list',
  usage: totalTokens === null ? undefined : { total_tokens: totalTokens },
});

describe('LobeVoyageAI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let runtime: LobeVoyageAI;

  const requestBodies = () =>
    fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

  beforeEach(() => {
    fetchMock = vi.fn(async () => json(embedResponse(1)));
    vi.stubGlobal('fetch', fetchMock);
    runtime = new LobeVoyageAI({ apiKey: 'test-key' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('is registered as the runtime of the voyage provider', () => {
    expect(providerRuntimeMap.voyage).toBe(LobeVoyageAI);
  });

  it('serves exactly the models of the model-bank catalog', () => {
    expect(Object.keys(VOYAGE_EMBEDDING_MODELS).sort()).toEqual(
      voyageModels.map((model) => model.id).sort(),
    );
  });

  describe('constructor', () => {
    it.each([undefined, '', '   '])('throws InvalidProviderAPIKey for the key %j', (apiKey) => {
      expect(() => new LobeVoyageAI({ apiKey })).toThrow(
        expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
      );
    });
  });

  describe('request validation', () => {
    const rejects = async (payload: Parameters<LobeVoyageAI['embeddings']>[0]) => {
      const error = await runtime.embeddings(payload).catch((e) => e);
      expect(fetchMock).not.toHaveBeenCalled();
      return error;
    };

    it('has no default model: a missing model is an error', async () => {
      const error = await rejects({ input: 'hello', model: '' });

      expect(error).toMatchObject({
        errorType: AgentRuntimeErrorType.InvalidRequestFormat,
        provider: 'voyage',
      });
      expect(error.error.message).toContain('no default model');
    });

    it.each(['text-embedding-3-small', 'voyage-9000', 'rerank-3'])(
      'rejects "%s", which is not a Voyage embedding model',
      async (model) => {
        const error = await rejects({ input: 'hello', model });

        expect(error.errorType).toBe(AgentRuntimeErrorType.ModelNotFound);
        expect(error.error.message).toContain(`"${model}"`);
      },
    );

    it.each([
      ['voyage-finance-2', 512],
      ['voyage-law-2', 2048],
      ['voyage-4', 768],
    ])('rejects output dimension %s / %d', async (model, dimensions) => {
      const error = await rejects({ dimensions, input: 'hello', model });

      expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidRequestFormat);
      expect(error.error.message).toContain('supports output dimensions');
    });

    it.each([[[]], [['ok', '']], [''] as unknown[]])('rejects empty input %j', async (input) => {
      const error = await rejects({ input: input as string[], model: 'voyage-4' });

      expect(error.errorType).toBe(AgentRuntimeErrorType.InvalidRequestFormat);
    });
  });

  describe('text embeddings', () => {
    it('posts to /embeddings without input_type or output_dimension unless asked', async () => {
      await runtime.embeddings({ input: 'hello', model: 'voyage-4-lite' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://api.voyageai.com/v1/embeddings');
      expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
        'Bearer test-key',
      );
      expect(requestBodies()[0]).toEqual({ input: ['hello'], model: 'voyage-4-lite' });
    });

    it('sends output_dimension for a requested Matryoshka size and returns the vectors in order', async () => {
      fetchMock.mockResolvedValue(
        json({
          data: [
            { embedding: [2], index: 1, object: 'embedding' },
            { embedding: [1], index: 0, object: 'embedding' },
          ],
          usage: { total_tokens: 4 },
        }),
      );

      const result = await runtime.embeddings({
        dimensions: 256,
        input: ['a', 'b'],
        model: 'voyage-3.5',
      });

      expect(requestBodies()[0]).toMatchObject({ output_dimension: 256 });
      expect(result).toEqual([[1], [2]]);
    });

    it('refuses more inputs than one request allows before sending anything', async () => {
      const error = await runtime
        .embeddings({
          input: Array.from({ length: VOYAGE_MAX_INPUTS_PER_REQUEST + 1 }, (_, i) => `t${i}`),
          model: 'voyage-4-lite',
        })
        .catch((e) => e);

      expect(error).toMatchObject({ errorType: AgentRuntimeErrorType.InvalidRequestFormat });
      expect(error.error.message).toContain('at most 1000 inputs');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('prices the reported tokens from the catalog', async () => {
      fetchMock.mockResolvedValue(json(embedResponse(1, 1_000_000)));
      const onUsage = vi.fn();

      await runtime.embeddings({ input: 'hello', model: 'voyage-code-3' }, { onUsage });

      // voyage-code-3 is $0.18 per million tokens.
      expect(onUsage.mock.calls[0][0].cost).toBeCloseTo(0.18, 10);
    });

    it('fails closed when the response carries no usage instead of billing nothing', async () => {
      fetchMock.mockResolvedValue(json(embedResponse(1, null)));
      const onUsage = vi.fn();

      const error = await runtime
        .embeddings({ input: 'hello', model: 'voyage-4' }, { onUsage })
        .catch((e) => e);

      expect(error).toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBizError });
      expect(error.error.message).toContain('token usage');
      expect(onUsage).not.toHaveBeenCalled();
    });

    it('fails when the API returns a different number of vectors than inputs', async () => {
      fetchMock.mockResolvedValue(json(embedResponse(1)));

      const error = await runtime
        .embeddings({ input: ['a', 'b'], model: 'voyage-4' })
        .catch((e) => e);

      expect(error.errorType).toBe(AgentRuntimeErrorType.ProviderBizError);
    });
  });

  describe('contextualized embeddings', () => {
    const contextualizedResponse = {
      data: [
        {
          data: [
            { embedding: [1], index: 0, object: 'embedding', text: 'first chunk' },
            { embedding: [2], index: 1, object: 'embedding', text: 'second chunk' },
          ],
          index: 0,
          object: 'list',
        },
        {
          data: [{ embedding: [3], index: 0, object: 'embedding', text: 'only chunk' }],
          index: 1,
          object: 'list',
        },
      ],
      model: 'voyage-context-4',
      object: 'list',
      usage: { total_tokens: 30 },
    };

    it.each(['voyage-context-4', 'voyage-context-3'])(
      '%s sends one string per document with auto-chunking, as document input, to /contextualizedembeddings',
      async (model) => {
        fetchMock.mockResolvedValue(json(contextualizedResponse));

        await runtime.embeddings({ dimensions: 512, input: ['doc one', 'doc two'], model });

        const [url] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://api.voyageai.com/v1/contextualizedembeddings');
        expect(requestBodies()[0]).toEqual({
          chunk_size: VOYAGE_CONTEXTUALIZED_CHUNK_SIZE,
          enable_auto_chunking: true,
          input_type: 'document',
          // The SDK sends one single-string list per document: one string per document.
          inputs: [['doc one'], ['doc two']],
          model,
          output_dimension: 512,
        });
        expect(VOYAGE_CONTEXTUALIZED_CHUNK_SIZE).toBe(32_000);
      },
    );

    it('returns the chunk vectors of every document in order, not one per input', async () => {
      fetchMock.mockResolvedValue(json(contextualizedResponse));
      const onUsage = vi.fn();

      const result = await runtime.embeddings(
        { input: ['doc one', 'doc two'], model: 'voyage-context-4' },
        { onUsage },
      );

      expect(result).toEqual([[1], [2], [3]]);
      expect(onUsage.mock.calls[0][0]).toMatchObject({ totalTokens: 30 });
    });

    it('fails when the API answers for a different number of documents', async () => {
      fetchMock.mockResolvedValue(json(contextualizedResponse));

      const error = await runtime
        .embeddings({ input: 'one document', model: 'voyage-context-3' })
        .catch((e) => e);

      expect(error.errorType).toBe(AgentRuntimeErrorType.ProviderBizError);
    });
  });

  describe('API errors', () => {
    it.each([
      [401, AgentRuntimeErrorType.InvalidProviderAPIKey],
      [403, AgentRuntimeErrorType.PermissionDenied],
      [429, AgentRuntimeErrorType.RateLimitExceeded],
      [400, AgentRuntimeErrorType.InvalidRequestFormat],
      [500, AgentRuntimeErrorType.ProviderBizError],
    ])('maps HTTP %d to the right error type and keeps the Voyage detail', async (status, type) => {
      fetchMock.mockResolvedValue(json({ detail: 'Voyage says no' }, status));

      const error = await runtime.embeddings({ input: 'hello', model: 'voyage-4' }).catch((e) => e);

      expect(error).toMatchObject({ errorType: type, provider: 'voyage' });
      expect(error.error.message).toBe('Voyage says no');
      expect(JSON.stringify(error)).not.toContain('test-key');
    });
  });
});

describe('extractVoyageErrorDetail', () => {
  it('reads a string detail', () => {
    expect(extractVoyageErrorDetail({ detail: ' Provided API key is invalid. ' })).toBe(
      'Provided API key is invalid.',
    );
  });

  it('joins the messages of a validation error list', () => {
    expect(
      extractVoyageErrorDetail({ detail: [{ msg: 'field required' }, { msg: 'bad value' }] }),
    ).toBe('field required; bad value');
  });

  it.each([undefined, null, 'plain text', { detail: 42 }, { detail: [] }, { message: 'x' }])(
    'returns undefined for %j instead of echoing the payload',
    (body) => {
      expect(extractVoyageErrorDetail(body)).toBeUndefined();
    },
  );
});
