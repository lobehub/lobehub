// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { aceChatProtocol, isOfficialAceEndpoint, loadAceCatalog } from './catalog';

describe('Ace public catalog', () => {
  it('retains typed chat models independent of their names and caches only public metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            { id: 'gpt-4o-image', modality: 'chat' },
            { id: 'new-model', modality: 'chat' },
            { id: 'looks-like-chat', modality: 'image' },
            null,
          ],
        }),
      ),
    );
    expect((await loadAceCatalog(fetcher)).map((model) => model.id)).toEqual([
      'gpt-4o-image',
      'new-model',
    ]);
    await loadAceCatalog(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' });
  });

  it('allows retry after a metadata failure without a hardcoded fallback', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: 'fresh', modality: 'chat' }] })),
      );
    await expect(loadAceCatalog(fetcher)).rejects.toThrow('Unable to load');
    expect((await loadAceCatalog(fetcher))[0].id).toBe('fresh');
  });

  it('does not send customer inference to an endpoint supplied by untrusted metadata', () => {
    const model = {
      id: 'example',
      modality: 'chat',
      capabilities: [],
      endpoints: [
        {
          protocol: 'messages',
          path: '/v1/messages',
          auth: 'bearer',
          base_url: 'https://example.test',
        },
      ],
    };
    expect(() => aceChatProtocol(model)).toThrow('No published chat protocol');
    expect(isOfficialAceEndpoint('https://custom.example/v1')).toBe(false);
    expect(isOfficialAceEndpoint('https://api.acedata.cloud.evil.test/v1')).toBe(false);
  });
});
