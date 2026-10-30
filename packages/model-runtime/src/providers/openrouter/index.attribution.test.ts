// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LobeOpenRouterAI, params } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://lobehub.com',
  'X-OpenRouter-Categories': 'personal-agent,general-chat',
  'X-OpenRouter-Title': 'LobeHub',
};

describe('LobeOpenRouterAI app attribution', () => {
  it('declares the attribution headers', () => {
    expect(params.constructorOptions.defaultHeaders).toEqual(ATTRIBUTION_HEADERS);
  });

  it('sends the attribution headers on requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [], object: 'list' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const instance = new LobeOpenRouterAI({ apiKey: 'test', fetch: fetchMock });

    await instance['client'].models.list();

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    for (const [name, value] of Object.entries(ATTRIBUTION_HEADERS)) {
      expect(headers.get(name)).toBe(value);
    }
  });
});
