import { describe, expect, it } from 'vitest';

import { convertOpenAIMessages } from './openai';

/**
 * Moonshot (official API and Novita) rejects `{ type: 'text', text: '' }` with 400
 * "text content is empty"; a tool-call-only turn with a signed reasoning block used
 * to become `[thinking, text: '']` and leave that empty part behind.
 */
describe('convertOpenAIMessages empty text parts', () => {
  it('should send null content for a signed tool-call-only assistant turn', async () => {
    const toolCalls = [
      {
        function: { arguments: '{}', name: 'activateSkill' },
        id: 'call_1',
        type: 'function',
      },
    ];
    const messages = [
      {
        content: [
          { signature: 'sig', thinking: '', type: 'thinking' },
          { text: '', type: 'text' },
        ],
        role: 'assistant',
        tool_calls: toolCalls,
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([{ content: null, role: 'assistant', tool_calls: toolCalls }]);
  });

  it('should drop empty text parts but keep non-empty assistant parts', async () => {
    const messages = [
      {
        content: [
          { signature: 'sig', thinking: 'plan', type: 'thinking' },
          { text: '', type: 'text' },
          { text: 'Answer', type: 'text' },
        ],
        role: 'assistant',
      },
      {
        content: [
          { signature: 'sig', thinking: 'plan', type: 'thinking' },
          { text: undefined, type: 'text' },
        ],
        role: 'assistant',
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { content: [{ text: 'Answer', type: 'text' }], role: 'assistant' },
      { content: '', role: 'assistant' },
    ]);
  });

  it('should not send an empty array for assistant turns without content', async () => {
    const toolCalls = [
      { function: { arguments: '{}', name: 'search' }, id: 'call_2', type: 'function' },
    ];
    const messages = [
      { content: null, role: 'assistant', tool_calls: toolCalls },
      { content: [], role: 'assistant', tool_calls: toolCalls },
      { content: [], role: 'assistant' },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { content: null, role: 'assistant', tool_calls: toolCalls },
      { content: null, role: 'assistant', tool_calls: toolCalls },
      { content: '', role: 'assistant' },
    ]);
  });

  it('should keep user message parts unchanged', async () => {
    const messages = [{ content: [{ text: '', type: 'text' }], role: 'user' }] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual(messages);
  });
});
