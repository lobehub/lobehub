// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { SSRFBlockedError, validateSsrfAddress } from '@lobechat/ssrf-safe-fetch';
import { AgentRuntimeErrorType } from '@lobechat/types';
import { ModelProvider } from 'model-bank';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeWithUserPayload } from './index';
import {
  createProviderBaseURLBlockedError,
  createUserEndpointGuardedRuntime,
  resolveUserEndpointSsrfPolicy,
} from './userEndpointGuard';

const edition = vi.hoisted(() => ({ cloud: false }));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get ENABLE_BUSINESS_FEATURES() {
    return edition.cloud;
  },
}));

vi.mock('@/envs/llm', () => ({ getLLMConfig: vi.fn(() => ({ OPENAI_API_KEY: 'env-key' })) }));
vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));

/**
 * A stand-in for a model server on the loopback interface — exactly what a
 * user-supplied `http://127.0.0.1:…` / `http://localhost:11434` baseURL hits.
 */
let hits: string[] = [];
let server: http.Server;
let baseURL: string;

const sseCompletion = [
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hi from loopback"},"finish_reason":null}]}',
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  'data: [DONE]',
  '',
].join('\n\n');

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);

    if (req.url?.startsWith('/redirect')) {
      res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }

    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'local-model', object: 'model' }] }));
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sseCompletion);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  hits = [];
  edition.cloud = false;
  vi.unstubAllEnvs();
});

const chat = (provider: string, endpoint: string) =>
  initModelRuntimeWithUserPayload(provider, { apiKey: 'user-key', baseURL: endpoint }).chat({
    messages: [{ content: 'hello', role: 'user' }],
    model: 'local-model',
    stream: true,
    temperature: 0,
  });

describe('resolveUserEndpointSsrfPolicy', () => {
  it('cloud always blocks private addresses, even when the env asks to allow them', () => {
    edition.cloud = true;
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');

    expect(resolveUserEndpointSsrfPolicy().allowPrivateIPAddress).toBe(false);
  });

  it('self-hosted allows private addresses by default and blocks with SSRF_ALLOW_PRIVATE_IP_ADDRESS=0', () => {
    expect(resolveUserEndpointSsrfPolicy().allowPrivateIPAddress).toBe(true);

    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '0');
    expect(resolveUserEndpointSsrfPolicy().allowPrivateIPAddress).toBe(false);
  });

  it('reads the allow list from SSRF_ALLOW_IP_ADDRESS_LIST', () => {
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', '10.0.0.5, 192.168.0.0/16,');

    expect(resolveUserEndpointSsrfPolicy().allowIPAddressList).toEqual([
      '10.0.0.5',
      '192.168.0.0/16',
    ]);
  });

  it.each(['169.254.169.254', 'fe80::1', '64:ff9b::a9fe:a9fe', '::ffff:a9fe:a9fe'])(
    'denies %s under the self-host policy even though private addresses are allowed',
    (address) => {
      expect(validateSsrfAddress(address, resolveUserEndpointSsrfPolicy())).toBeInstanceOf(
        SSRFBlockedError,
      );
    },
  );

  it('still allows a plain private address under the self-host policy', () => {
    expect(validateSsrfAddress('10.0.0.1', resolveUserEndpointSsrfPolicy())).toBeUndefined();
  });
});

describe('initModelRuntimeWithUserPayload SSRF guard', () => {
  describe('cloud', () => {
    it('refuses a loopback baseURL for chat with ProviderBaseURLBlocked; the server is never contacted', async () => {
      edition.cloud = true;

      await expect(chat(ModelProvider.OpenAI, baseURL)).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
        provider: ModelProvider.OpenAI,
      });
      expect(hits).toEqual([]);
    });

    it('refuses the model list request (models()) too', async () => {
      edition.cloud = true;
      const runtime = initModelRuntimeWithUserPayload(ModelProvider.OpenAI, {
        apiKey: 'user-key',
        baseURL,
      });

      await expect(runtime.models()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      });
      expect(hits).toEqual([]);
    });

    it('refuses embeddings', async () => {
      edition.cloud = true;
      const runtime = initModelRuntimeWithUserPayload(ModelProvider.OpenAI, {
        apiKey: 'user-key',
        baseURL,
      });

      await expect(
        runtime.embeddings({ input: 'hello', model: 'text-embedding-3-small' }),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked });
      expect(hits).toEqual([]);
    });

    it('covers non-OpenAI SDKs (Ollama) and custom providers', async () => {
      edition.cloud = true;
      const ollamaRuntime = initModelRuntimeWithUserPayload(ModelProvider.Ollama, {
        baseURL: baseURL.replace('/v1', ''),
      });

      await expect(ollamaRuntime.models()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      });

      await expect(
        initModelRuntimeWithUserPayload('my-custom-provider', {
          apiKey: 'user-key',
          baseURL,
          runtimeProvider: ModelProvider.OpenAI,
        }).models(),
      ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked });

      expect(hits).toEqual([]);
    });

    it('blocks an allow-listed endpoint that redirects (3xx) to a private address', async () => {
      edition.cloud = true;
      vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', '127.0.0.1');

      const redirecting = baseURL.replace('/v1', '/redirect/v1');
      await expect(chat(ModelProvider.OpenAI, redirecting)).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      });
      // The allow-listed first hop was served, the private redirect target was refused
      expect(hits).toEqual(['POST /redirect/v1/chat/completions']);
    });

    it('lets an allow-listed private endpoint stream normally', async () => {
      edition.cloud = true;
      vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', '127.0.0.1');

      const response = await chat(ModelProvider.OpenAI, baseURL);
      expect(await response.text()).toContain('hi from loopback');
      expect(hits).toEqual(['POST /v1/chat/completions']);
    });
  });

  describe('self-hosted', () => {
    it('keeps reaching a private endpoint by default (docker-network Ollama / LM Studio)', async () => {
      const response = await chat(ModelProvider.OpenAI, baseURL);

      expect(await response.text()).toContain('hi from loopback');
      expect(hits).toEqual(['POST /v1/chat/completions']);
    });

    it('blocks private endpoints when the operator sets SSRF_ALLOW_PRIVATE_IP_ADDRESS=0', async () => {
      vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '0');

      await expect(chat(ModelProvider.OpenAI, baseURL)).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      });
      expect(hits).toEqual([]);
    });

    it('blocks link-local metadata endpoints even though private addresses are allowed', async () => {
      await expect(
        chat(ModelProvider.OpenAI, 'http://169.254.169.254/latest'),
      ).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      });
    });
  });

  it('does not guard an operator-configured env proxy URL (no user baseURL in the payload)', async () => {
    edition.cloud = true;
    vi.stubEnv('OPENAI_PROXY_URL', baseURL);

    const response = await initModelRuntimeWithUserPayload(ModelProvider.OpenAI, {}).chat({
      messages: [{ content: 'hello', role: 'user' }],
      model: 'local-model',
      stream: true,
      temperature: 0,
    });

    expect(await response.text()).toContain('hi from loopback');
  });
});

describe('createUserEndpointGuardedRuntime', () => {
  it('only guards hosts of the user endpoints; other requests made inside the call pass through', async () => {
    edition.cloud = true;
    const otherOrigin = baseURL.replace('/v1', '');

    const runtime = createUserEndpointGuardedRuntime({
      create: () => ({
        // e.g. a platform hook or another service reached during the call
        fetchOther: () => fetch(`${otherOrigin}/v1/models`).then((res) => res.json()),
        fetchUserEndpoint: () => fetch(`http://localhost:11434/v1/models`),
      }),
      endpoints: ['http://localhost:11434/v1'],
      provider: 'openai',
    });

    await expect(runtime.fetchOther()).resolves.toEqual({
      data: [{ id: 'local-model', object: 'model' }],
    });
    await expect(runtime.fetchUserEndpoint()).rejects.toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
    });
  });

  it('returns the bare runtime when no endpoint is user-supplied', () => {
    edition.cloud = true;
    const bare = { chat: vi.fn() };

    expect(
      createUserEndpointGuardedRuntime({ create: () => bare, endpoints: [], provider: 'openai' }),
    ).toBe(bare);
  });

  describe('node:http transports', () => {
    /**
     * `@azure-rest/ai-inference` (via `@typespec/ts-http-runtime`) and similar
     * SDKs drive `node:http(s)` directly instead of `fetch`; the guard must
     * cover them by injecting a filtering agent.
     */
    const nodeTransport = () => ({
      probe: () =>
        new Promise<number>((resolve, reject) => {
          http
            .get(`${baseURL}/models`, (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            })
            .on('error', reject);
        }),
    });

    it('blocks node:http requests to a private endpoint host in cloud mode', async () => {
      edition.cloud = true;
      const runtime = createUserEndpointGuardedRuntime({
        create: nodeTransport,
        endpoints: [baseURL],
        provider: 'azureai',
      });

      await expect(runtime.probe()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      });
      expect(hits).toEqual([]);
    });

    it('still reaches a private endpoint over node:http when the policy allows private addresses', async () => {
      const runtime = createUserEndpointGuardedRuntime({
        create: nodeTransport,
        endpoints: [baseURL],
        provider: 'azureai',
      });

      await expect(runtime.probe()).resolves.toBe(200);
      expect(hits).toEqual(['GET /v1/models']);
    });
  });
});

describe('vertexAIRegion', () => {
  it.each(['us-central1.evil.com', 'evil.com/x', 'a b', 'a?b=1', 'x@evil.com'])(
    'rejects a region that could corrupt the derived aiplatform host: %s',
    (region) => {
      try {
        initModelRuntimeWithUserPayload(ModelProvider.VertexAI, {
          apiKey: JSON.stringify({ project_id: 'p' }),
          vertexAIRegion: region,
        });
        expect.unreachable(`region ${region} should be rejected`);
      } catch (error) {
        expect(error).toMatchObject({
          errorType: AgentRuntimeErrorType.InvalidVertexCredentials,
        });
      }
    },
  );
});

describe('createProviderBaseURLBlockedError', () => {
  it('does not leak the resolved address to the client', () => {
    const blocked = new SSRFBlockedError(
      'SSRF blocked: DNS lookup 10.1.2.3(family:4, host:internal.corp) is not allowed.',
    );
    blocked.address = '10.1.2.3';
    blocked.hostname = 'internal.corp';

    const error = createProviderBaseURLBlockedError('openai', blocked);

    expect(error).toMatchObject({
      errorType: AgentRuntimeErrorType.ProviderBaseURLBlocked,
      provider: 'openai',
    });
    expect(JSON.stringify(error)).not.toContain('10.1.2.3');
    expect(JSON.stringify(error)).not.toContain('DNS lookup');
  });
});
