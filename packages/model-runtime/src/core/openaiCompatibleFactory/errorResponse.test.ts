// @vitest-environment node
import { ModelProvider } from 'model-bank';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { createOpenAICompatibleRuntime } from './index';

const Runtime = createOpenAICompatibleRuntime({ provider: ModelProvider.OpenAI });

describe('OpenAI-compatible error responses', () => {
  it.each([
    { code: 403, message: 'not enough balance', reason: 'NOT_ENOUGH_BALANCE' },
    { message: 'Access denied', reason: 'ACCESS_DENY' },
  ])('preserves flat provider errors: $reason', async (body) => {
    const runtime = new Runtime({
      apiKey: 'test-key',
      fetch: async () => Response.json(body, { status: 403 }),
      maxRetries: 0,
    });

    await expect(
      runtime.client.chat.completions.create({ messages: [], model: 'test-model', stream: true }),
    ).rejects.toMatchObject({
      error: body,
      message: expect.stringContaining(body.message),
      status: 403,
    });
  });

  it('preserves standard nested errors and SDK error types', async () => {
    const error = { code: 'invalid_api_key', message: 'Invalid API key' };
    const runtime = new Runtime({
      apiKey: 'test-key',
      fetch: async () => Response.json({ error }, { status: 401 }),
      maxRetries: 0,
    });

    const request = runtime.client.chat.completions.create({ messages: [], model: 'test-model' });
    await expect(request).rejects.toBeInstanceOf(OpenAI.AuthenticationError);
    await expect(request).rejects.toMatchObject({ error, status: 401 });
  });

  it('keeps an empty 403 unclassified', async () => {
    const runtime = new Runtime({
      apiKey: 'test-key',
      fetch: async () => new Response(null, { status: 403 }),
      maxRetries: 0,
    });

    await expect(
      runtime.client.chat.completions.create({ messages: [], model: 'test-model' }),
    ).rejects.toMatchObject({
      error: undefined,
      message: '403 status code (no body)',
      status: 403,
    });
  });
});
