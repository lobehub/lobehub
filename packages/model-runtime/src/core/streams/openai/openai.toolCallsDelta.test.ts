import { describe, expect, it } from 'vitest';

import { transformResponseToStream } from '../../openaiCompatibleFactory/nonStreamToStream';
import { OpenAIStream } from './openai';

const toolCall = {
  function: { arguments: '{"city":"Paris"}', name: 'get_weather' },
  id: 'call_1',
  index: 0,
  type: 'function',
};

const toolCallsLines = [
  'id: chat_1\n',
  'event: tool_calls\n',
  `data: [{"function":{"arguments":"{\\"city\\":\\"Paris\\"}","name":"get_weather"},"id":"call_1","index":0,"type":"function"}]\n\n`,
];

const collect = async (deltas: Record<string, unknown>[]) => {
  const stream = new ReadableStream({
    start(controller) {
      for (const delta of deltas) {
        controller.enqueue({ choices: [{ delta, index: 0 }], id: 'chat_1' });
      }
      controller.close();
    },
  });

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  // @ts-ignore
  for await (const chunk of OpenAIStream(stream)) {
    chunks.push(decoder.decode(chunk, { stream: true }));
  }
  return chunks;
};

// https://github.com/lobehub/lobehub/issues/22389
describe('OpenAIStream tool_calls delta sharing a frame with reasoning/content', () => {
  it('keeps reasoning_content that shares a delta with tool_calls', async () => {
    const chunks = await collect([
      { reasoning_content: 'Now I will check ', role: 'assistant' },
      { reasoning_content: 'the weather.', tool_calls: [toolCall] },
    ]);

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: reasoning\n',
      'data: "Now I will check "\n\n',
      'id: chat_1\n',
      'event: reasoning\n',
      'data: "the weather."\n\n',
      ...toolCallsLines,
    ]);
  });

  it('keeps content that shares a delta with tool_calls', async () => {
    const chunks = await collect([{ content: 'Let me look that up.', tool_calls: [toolCall] }]);

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: text\n',
      'data: "Let me look that up."\n\n',
      ...toolCallsLines,
    ]);
  });

  it('emits reasoning -> text -> tool_calls when all three share a delta', async () => {
    const chunks = await collect([
      { content: 'Checking now.', reasoning_content: 'Need weather.', tool_calls: [toolCall] },
    ]);

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: reasoning\n',
      'data: "Need weather."\n\n',
      'id: chat_1\n',
      'event: text\n',
      'data: "Checking now."\n\n',
      ...toolCallsLines,
    ]);
  });

  it('splits a </think> close that shares a delta with tool_calls and ends thinking mode', async () => {
    const chunks = await collect([
      { content: '<think>plan the call' },
      { content: ' done</think>Calling it.', tool_calls: [toolCall] },
      { content: ' Result next.' },
    ]);

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: reasoning\n',
      'data: "plan the call"\n\n',
      'id: chat_1\n',
      'event: reasoning\n',
      'data: " done"\n\n',
      'id: chat_1\n',
      'event: text\n',
      'data: "Calling it."\n\n',
      ...toolCallsLines,
      'id: chat_1\n',
      'event: text\n',
      'data: " Result next."\n\n',
    ]);
  });

  it('keeps reasoning_details that share a delta with tool_calls', async () => {
    const chunks = await collect([
      { reasoning_details: [{ text: 'MiniMax thought.' }], tool_calls: [toolCall] },
    ]);

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: reasoning\n',
      'data: "MiniMax thought."\n\n',
      ...toolCallsLines,
    ]);
  });

  it('emits only the tool call when reasoning/content are empty or null', async () => {
    const chunks = await collect([
      { content: null, reasoning_content: '', role: 'assistant', tool_calls: [toolCall] },
    ]);

    expect(chunks).toEqual(toolCallsLines);
  });

  it('splits <think> content of a non-streaming response that also calls a tool', async () => {
    const stream = transformResponseToStream({
      choices: [
        {
          finish_reason: 'tool_calls',
          index: 0,
          logprobs: null,
          message: {
            content: '<think>need the tool</think>Calling it.',
            refusal: null,
            role: 'assistant',
            tool_calls: [toolCall as any],
          },
        },
      ],
      created: 0,
      id: 'chat_1',
      model: 'qwen3',
      object: 'chat.completion',
    });

    const decoder = new TextDecoder();
    const chunks: string[] = [];
    // @ts-ignore
    for await (const chunk of OpenAIStream(stream)) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    }

    expect(chunks).toEqual([
      'id: chat_1\n',
      'event: reasoning\n',
      'data: "need the tool"\n\n',
      'id: chat_1\n',
      'event: text\n',
      'data: "Calling it."\n\n',
      ...toolCallsLines,
      'id: chat_1\n',
      'event: stop\n',
      'data: "tool_calls"\n\n',
    ]);
  });
});
