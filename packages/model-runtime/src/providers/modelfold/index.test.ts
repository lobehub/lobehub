// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeModelFoldAI } from './index';

testProvider({
  chatDebugEnv: 'DEBUG_MODELFOLD_CHAT_COMPLETION',
  chatModel: 'deepseek-v4-flash',
  defaultBaseURL: 'https://modelfold.ai/v1',
  provider: 'modelfold',
  Runtime: LobeModelFoldAI,
});

describe('ModelFold model discovery', () => {
  it('uses the configured credential and lists only returned chat models', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        data: [
          { id: 'account-chat' },
          { id: 'deepseek-v4-flash' },
          { id: 'gemini-2.5-flash-image-preview' },
          { id: 'text-embedding-example' },
        ],
        object: 'list',
      }),
    );
    const runtime = new LobeModelFoldAI({ apiKey: 'unit-test-only', fetch });

    const models = await runtime.models();
    expect(models.map(({ id }) => id)).toEqual([
      'account-chat',
      'deepseek-v4-flash',
      'gemini-2.5-flash-image-preview',
    ]);
    expect(models.find(({ id }) => id === 'deepseek-v4-flash')).toMatchObject({
      contextWindowTokens: 1_048_576,
      functionCall: true,
      reasoning: true,
      type: 'chat',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://modelfold.ai/v1/models');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer unit-test-only');
  });
});

describe('ModelFold chat transport', () => {
  it('uses Chat Completions for a model that otherwise selects Responses', async () => {
    const model = 'gpt-5-mini';
    const tool = {
      function: { name: 'lookup', parameters: { type: 'object' } },
      type: 'function',
    } as const;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'tool_calls',
            index: 0,
            message: {
              content: null,
              role: 'assistant',
              tool_calls: [
                { function: { arguments: '{}', name: 'lookup' }, id: 'call_1', type: 'function' },
              ],
            },
          },
        ],
        created: 1,
        id: 'chatcmpl-test',
        model,
        object: 'chat.completion',
      }),
    );
    const runtime = new LobeModelFoldAI({ apiKey: 'unit-test-only', fetch });
    const response = await runtime.chat({
      messages: [{ content: 'Look it up.', role: 'user' }],
      model,
      stream: false,
      temperature: 1,
      tools: [tool],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://modelfold.ai/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model, stream: false, tools: [tool] });
    expect(await response.text()).toContain('lookup');
  });
});
