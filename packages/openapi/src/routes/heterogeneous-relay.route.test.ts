import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as HeterogeneousDirectService from '../services/heterogeneous-direct.service';

const invokeServerDefaultModel = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromServerConfig: vi.fn(),
  resolveServerDefaultHeterogeneousModel: vi.fn(),
}));
vi.mock('../middleware/hetero-operation-auth', () => {
  const requireHeteroModelInvocation =
    (ingress: 'anthropic-messages' | 'openai-responses'): MiddlewareHandler =>
    async (c, next) => {
      c.set(
        'heteroOperationClaims' as never,
        { model: 'deepseek-v4-pro', provider_id: 'lobehub' } as never,
      );
      c.set(
        'heteroAgentType' as never,
        (ingress === 'anthropic-messages' ? 'kimi-code' : 'grok-build') as never,
      );
      c.set('userId' as never, 'user-1' as never);
      await next();
    };

  return { requireHeteroModelInvocation };
});
vi.mock('../services/heterogeneous-direct.service', async (importOriginal) => {
  const actual = await importOriginal<typeof HeterogeneousDirectService>();
  return { ...actual, invokeServerDefaultModel };
});

const [{ default: anthropicRoutes }, { default: openaiRoutes }] = await Promise.all([
  import('./anthropic.route'),
  import('./openai.route'),
]);

const app = new Hono();
app.route('/anthropic', anthropicRoutes);
app.route('/openai', openaiRoutes);

const runtimeFailure = {
  error: { message: 'invalid value adaptive' },
  errorType: 'ProviderBizError',
  provider: 'volcengine',
};
const failureMessage = '[volcengine] ProviderBizError: invalid value adaptive';

describe('heterogeneous relay route failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeServerDefaultModel.mockRejectedValue(runtimeFailure);
  });

  it('returns an Anthropic error envelope when model invocation rejects', async () => {
    const response = await app.request('/anthropic/v1/messages', {
      body: JSON.stringify({
        messages: [{ content: 'hello', role: 'user' }],
        model: 'lobehub/deepseek-v4-pro',
        stream: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { message: failureMessage, type: 'api_error' },
      type: 'error',
    });
    expect(invokeServerDefaultModel).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'kimi-code' }),
    );
  });

  it('returns an OpenAI error envelope when model invocation rejects', async () => {
    const response = await app.request('/openai/v1/responses', {
      body: JSON.stringify({
        input: 'hello',
        model: 'lobehub/deepseek-v4-pro',
        stream: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { message: failureMessage, type: 'api_error' },
    });
    expect(invokeServerDefaultModel).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'grok-build' }),
    );
  });
});
