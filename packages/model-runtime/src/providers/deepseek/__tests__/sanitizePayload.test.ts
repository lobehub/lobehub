// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { sanitizeDeepSeekJsonPayload } from '../sanitizePayload';
import { loneHighSurrogate, loneLowSurrogate, validEmoji } from './testUtils';

describe('sanitizeDeepSeekJsonPayload', () => {
  it('should sanitize request text surfaces only', () => {
    const payload = {
      messages: [
        { content: `Hello ${loneHighSurrogate} ${validEmoji}`, role: 'user' },
        {
          content: [{ text: `Block ${loneLowSurrogate} ${validEmoji}`, type: 'text' }],
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: `{"query":"${loneHighSurrogate} ${validEmoji}"}`,
                name: 'search',
              },
              id: 'call_1',
              type: 'function',
            },
          ],
        },
        {
          content: [
            {
              input: {
                nested: { values: [`Nested ${loneLowSurrogate} ${validEmoji}`] },
                query: `Tool ${loneHighSurrogate} ${validEmoji}`,
              },
              name: 'search',
              type: 'tool_use',
            },
          ],
          role: 'assistant',
        },
      ],
      metadata: {
        note: loneHighSurrogate,
      },
      system: [{ text: `System ${loneHighSurrogate} ${validEmoji}`, type: 'text' }],
      tools: [
        {
          description: loneHighSurrogate,
          input_schema: {
            properties: {
              query: { description: loneHighSurrogate, type: 'string' },
            },
            type: 'object',
          },
          name: 'search',
        },
      ],
    };

    const result = sanitizeDeepSeekJsonPayload(payload);

    expect(JSON.stringify(result.messages)).not.toContain('\\ud83d');
    expect(JSON.stringify(result.messages)).not.toContain('\\udc1b');
    expect(JSON.stringify(result.system)).not.toContain('\\ud83d');
    expect(JSON.stringify(result.metadata)).toContain('\\ud83d');
    expect(JSON.stringify(result.tools)).toContain('\\ud83d');
  });

  it('should keep non-plain objects unchanged', () => {
    const createdAt = new Date('2026-05-22T00:00:00.000Z');
    const payload = {
      messages: [{ content: 'Hello', role: 'user' }],
      metadata: { createdAt },
    };

    const result = sanitizeDeepSeekJsonPayload(payload);

    expect(result.metadata.createdAt).toBe(createdAt);
  });
});
