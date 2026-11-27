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
          { id: 'gemini-2.5-flash-image-preview' },
          { id: 'text-embedding-example' },
        ],
        object: 'list',
      }),
    );
    const runtime = new LobeModelFoldAI({ apiKey: 'unit-test-only', fetch });

    expect((await runtime.models()).map(({ id }) => id)).toEqual([
      'account-chat',
      'gemini-2.5-flash-image-preview',
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://modelfold.ai/v1/models');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer unit-test-only');
  });
});
