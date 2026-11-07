import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { estimateRequestTokens, MEDIA_PART_TOKENS } from '../requestTokens';

describe('estimateRequestTokens', () => {
  it('counts tool calls in the OpenAI wire format', () => {
    const args = JSON.stringify({ command: 'ls -la '.repeat(200) });
    const { rawTotal } = estimateRequestTokens({
      driftMultiplier: 1,
      messages: [
        {
          content: '',
          role: 'assistant',
          tool_calls: [{ function: { arguments: args, name: 'runCommand' }, id: 'call_1' }],
        },
      ],
    });

    expect(rawTotal).toBeGreaterThanOrEqual(estimateTokenCount(args));
  });

  it('counts a base64 image as a flat media cost instead of its URL text', () => {
    const dataUri = `data:image/png;base64,${'A'.repeat(500_000)}`;
    const { rawTotal } = estimateRequestTokens({
      driftMultiplier: 1,
      messages: [
        {
          content: [
            { text: 'look', type: 'text' },
            { image_url: { url: dataUri }, type: 'image_url' },
          ],
          role: 'user',
        },
      ],
    });

    expect(rawTotal).toBe(estimateTokenCount('look') + MEDIA_PART_TOKENS);
  });

  it('includes tool definitions and applies the drift multiplier', () => {
    const tool = { function: { description: 'Read a file', name: 'readFile' }, type: 'function' };
    const { adjustedTotal, rawTotal } = estimateRequestTokens({
      driftMultiplier: 2,
      messages: [{ content: 'hello', role: 'user' }],
      tools: [tool],
    });

    expect(rawTotal).toBe(estimateTokenCount('hello') + estimateTokenCount(JSON.stringify(tool)));
    expect(adjustedTotal).toBe(rawTotal * 2);
  });
});
