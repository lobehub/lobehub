import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as HeterogeneousDirectService from '../services/heterogeneous-direct.service';

const invokeServerDefaultModel = vi.hoisted(() => vi.fn());
const relayContext = vi.hoisted(() => ({
  anthropicAgentType: 'kimi-code',
  model: 'deepseek-v4-pro',
}));

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
        { model: relayContext.model, provider_id: 'lobehub' } as never,
      );
      c.set(
        'heteroAgentType' as never,
        (ingress === 'anthropic-messages'
          ? relayContext.anthropicAgentType
          : 'grok-build') as never,
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
    relayContext.anthropicAgentType = 'kimi-code';
    relayContext.model = 'deepseek-v4-pro';
    invokeServerDefaultModel.mockRejectedValue(runtimeFailure);
  });

  it.each(['/anthropic/v1/messages', '/openai/v1/responses'])(
    'preserves terminal and retryable errors at %s',
    async (path) => {
      for (const [errorType, status, retryable] of [
        [403, 403, false],
        ['InvalidRequestFormat', 400, false],
        ['RateLimitExceeded', 429, true],
        ['InsufficientQuota', 429, false],
        ['DatabasePersistError', 500, false],
        ['ProviderBizError', 502, true],
      ] as const) {
        invokeServerDefaultModel.mockRejectedValue({ error: 'fixture failure', errorType });
        const response = await app.request(path, {
          body: JSON.stringify({
            input: 'hello',
            messages: [],
            model: 'lobehub/deepseek-v4-pro',
            stream: true,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });

        expect(response.status).toBe(status);
        expect(response.headers.get('x-should-retry')).toBe(String(retryable));
        const body = await response.json();
        expect(body.error.message).toContain('fixture failure');
        expect(body.error.type).toBe('api_error');
        if (path.startsWith('/anthropic')) expect(body.type).toBe('error');
      }
    },
  );

  it.each(['/anthropic/v1/messages', '/openai/v1/responses'])(
    'preserves transient statuses despite coarse or conflicting messages at %s',
    async (path) => {
      for (const status of [408, 409, 429, 503]) {
        for (const error of [
          { status, message: 'No details' },
          { message: `${status} status code (no body)` },
          { status, message: 'text content blocks must be non-empty' },
          { message: `${status} text content blocks must be non-empty` },
        ]) {
          invokeServerDefaultModel.mockRejectedValue({ error, errorType: 'ProviderBizError' });
          const response = await app.request(path, {
            body: JSON.stringify({
              input: 'hello',
              messages: [],
              model: 'lobehub/deepseek-v4-pro',
              stream: true,
            }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          });
          expect(response.status).toBe(status);
          expect(response.headers.get('x-should-retry')).toBe('true');
        }
      }
    },
  );

  it.each(['/anthropic/v1/messages', '/openai/v1/responses'])(
    'keeps quota and explicitly typed request failures terminal at %s',
    async (path) => {
      for (const [errorType, message] of [
        ['ProviderBizError', 'Insufficient quota'],
        ['InvalidRequestFormat', 'text content blocks must be non-empty'],
      ]) {
        invokeServerDefaultModel.mockRejectedValue({ error: { message, status: 429 }, errorType });
        const response = await app.request(path, {
          body: JSON.stringify({
            input: 'hello',
            messages: [],
            model: 'lobehub/deepseek-v4-pro',
            stream: true,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
        expect(response.status).toBe(429);
        expect(response.headers.get('x-should-retry')).toBe('false');
        expect((await response.json()).error.message).toContain(message);
      }
    },
  );

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

  it('unwraps Claude Code system reminders before invoking a GPT model', async () => {
    relayContext.anthropicAgentType = 'claude-code';
    relayContext.model = 'gpt-6-astra';

    await app.request('/anthropic/v1/messages', {
      body: JSON.stringify({
        messages: [
          {
            content: '<system-reminder>Current date context</system-reminder>\n\nMarker prompt',
            role: 'user',
          },
        ],
        model: 'lobehub/gpt-6-astra',
        stream: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(invokeServerDefaultModel).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'claude-code',
        model: 'gpt-6-astra',
        payload: expect.objectContaining({
          messages: [{ content: 'Current date context\n\nMarker prompt', role: 'user' }],
        }),
      }),
    );
  });

  it('preserves Claude Code system reminder markup for Claude models', async () => {
    relayContext.anthropicAgentType = 'claude-code';
    relayContext.model = 'claude-fable-5-1';
    const content = '<system-reminder>Current date context</system-reminder>\n\nMarker prompt';

    await app.request('/anthropic/v1/messages', {
      body: JSON.stringify({
        messages: [{ content, role: 'user' }],
        model: 'lobehub/claude-fable-5-1',
        stream: true,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    expect(invokeServerDefaultModel).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ messages: [{ content, role: 'user' }] }),
      }),
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
