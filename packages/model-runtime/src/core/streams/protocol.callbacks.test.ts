import { describe, expect, it, vi } from 'vitest';

import { createCallbacksTransformer } from './protocol';

const runChunks = async (
  chunks: string[],
  callbacks: Parameters<typeof createCallbacksTransformer>[0],
) => {
  const stream = new ReadableStream<string>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(createCallbacksTransformer(callbacks));

  const reader = stream.getReader();
  while (!(await reader.read()).done);
};

const sse = (type: string, data: unknown) => [
  `event: ${type}\n`,
  `data: ${JSON.stringify(data)}\n\n`,
];

describe('createCallbacksTransformer payloads containing the SSE field marker', () => {
  it('keeps text that contains `data:`', async () => {
    const onText = vi.fn();
    const onCompletion = vi.fn();
    const text = 'the metadata: field is required';

    await runChunks(sse('text', text), { onCompletion, onText });

    expect(onText).toHaveBeenCalledWith(text);
    expect(onCompletion).toHaveBeenCalledWith(expect.objectContaining({ text }));
  });

  it('keeps reasoning that contains `data:`', async () => {
    const onThinking = vi.fn();
    const thinking = 'check the data: it looks wrong';

    await runChunks(sse('reasoning', thinking), { onThinking });

    expect(onThinking).toHaveBeenCalledWith(thinking);
  });

  it('keeps tool call arguments that contain a data URI', async () => {
    const onToolsCalling = vi.fn();
    const args = JSON.stringify({ url: 'data:image/png;base64,AAAA' });

    await runChunks(
      sse('tool_calls', [
        { function: { arguments: args, name: 'view' }, id: 'call_1', index: 0, type: 'function' },
      ]),
      { onToolsCalling },
    );

    expect(onToolsCalling).toHaveBeenCalledTimes(1);
    expect(onToolsCalling.mock.calls[0][0].toolsCalling[0].function.arguments).toBe(args);
  });
});
