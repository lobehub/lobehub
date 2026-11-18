import { describe, expect, it } from 'vitest';

import { buildAnthropicMessages, buildAnthropicTools } from './messages';

describe('cache TTL propagation', () => {
  it('stamps ttl 1h on the last message cache_control when cacheTTL is 1h', async () => {
    const contents = await buildAnthropicMessages([{ content: 'Hello', role: 'user' }], {
      cacheTTL: '1h',
      enabledContextCaching: true,
    });

    expect(contents).toEqual([
      {
        content: [{ cache_control: { ttl: '1h', type: 'ephemeral' }, text: 'Hello', type: 'text' }],
        role: 'user',
      },
    ]);
  });

  it('keeps the wire format unchanged when cacheTTL is the default 5m', async () => {
    const explicit = await buildAnthropicMessages([{ content: 'Hello', role: 'user' }], {
      cacheTTL: '5m',
      enabledContextCaching: true,
    });
    const implicit = await buildAnthropicMessages([{ content: 'Hello', role: 'user' }], {
      enabledContextCaching: true,
    });

    expect(explicit).toEqual(implicit);
    expect(explicit[0].content).toEqual([
      { cache_control: { type: 'ephemeral' }, text: 'Hello', type: 'text' },
    ]);
  });

  it('stamps ttl 1h on the last tool cache_control', () => {
    const result = buildAnthropicTools(
      [
        {
          function: { description: 'test tool', name: 'tool1', parameters: {} },
          type: 'function',
        },
      ],
      { cacheTTL: '1h', enabledContextCaching: true },
    );

    expect(result?.[0].cache_control).toEqual({ ttl: '1h', type: 'ephemeral' });
  });
});
