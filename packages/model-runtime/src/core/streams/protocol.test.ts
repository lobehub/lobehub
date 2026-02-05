import { describe, expect, it, vi } from 'vitest';

import {
  convertIterableToStream,
  createCallbacksTransformer,
  createFirstErrorHandleTransformer,
  createSSEDataExtractor,
  createSSEProtocolTransformer,
  createTokenSpeedCalculator,
  FIRST_CHUNK_ERROR_KEY,
} from './protocol';

describe('createSSEDataExtractor', () => {
  // Helper function to convert string to Uint8Array
  const stringToUint8Array = (str: string): Uint8Array => {
    return new TextEncoder().encode(str);
  };

  // Helper function to process chunks through transformer
  const processChunk = async (transformer: TransformStream, chunk: Uint8Array) => {
    const results: any[] = [];
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const writable = new WritableStream({
      write(chunk) {
        results.push(chunk);
      },
    });

    await readable.pipeThrough(transformer).pipeTo(writable);

    return results;
  };

  it('should correctly transform single SSE data line', async () => {
    const transformer = createSSEDataExtractor();
    const input = 'data: {"message": "hello"}\n';
    const chunk = stringToUint8Array(input);

    const results = await processChunk(transformer, chunk);

    expect(results).toEqual([{ message: 'hello' }]);
  });

  it('should handle multiple SSE data lines', async () => {
    const transformer = createSSEDataExtractor();
    const input = `data: {"message": "hello"}\ndata: {"message": "world"}\n`;
    const chunk = stringToUint8Array(input);

    const results = await processChunk(transformer, chunk);

    expect(results).toEqual([{ message: 'hello' }, { message: 'world' }]);
  });

  it('should ignore non-data lines', async () => {
    const transformer = createSSEDataExtractor();
    const input = `id: 1\ndata: {"message": "hello"}\nevent: message\n`;
    const chunk = stringToUint8Array(input);

    const results = await processChunk(transformer, chunk);

    expect(results).toEqual([{ message: 'hello' }]);
  });

  it('should skip [DONE] heartbeat messages', async () => {
    const transformer = createSSEDataExtractor();
    const input = `data: {"message": "hello"}\ndata: [DONE]\ndata: {"message": "world"}\n`;
    const chunk = stringToUint8Array(input);

    const results = await processChunk(transformer, chunk);

    expect(results).toEqual([{ message: 'hello' }, { message: 'world' }]);
  });

  it('should handle invalid JSON gracefully', async () => {
    const transformer = createSSEDataExtractor();
    const input = `data: {"message": "hello"}\ndata: invalid-json\ndata: {"message": "world"}\n`;
    const chunk = stringToUint8Array(input);

    const results = await processChunk(transformer, chunk);

    expect(results).toEqual([{ message: 'hello' }, { message: 'world' }]);
  });

  it('should handle empty data lines', async () => {
    const transformer = createSSEDataExtractor();
    const input = `data: \ndata: {"message": "hello"}\ndata: \n`;
    const chunk = stringToUint8Array(input);

    const results = await processChunk(transformer, chunk);

    expect(results).toEqual([{ message: 'hello' }]);
  });

  it('should process large chunks of data correctly', async () => {
    const transformer = createSSEDataExtractor();
    const messages = Array.from({ length: 100 })
      .fill(null)
      .map((_, i) => `data: {"message": "message${i}"}\n`)
      .join('');
    const chunk = stringToUint8Array(messages);

    const results = await processChunk(transformer, chunk);

    expect(results).toHaveLength(100);
    expect(results[0]).toEqual({ message: 'message0' });
    expect(results[99]).toEqual({ message: 'message99' });
  });

  describe('real world data', () => {
    it('should convert azure ai data', async () => {
      const chunks = [
        `data: {"choices":[{"delta":{"content":"","reasoning_content":null,"role":"assistant","tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714651,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"\u003Cthink\u003E","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714651,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"\n\n","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714651,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"\u003C/think\u003E","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714651,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"\n\n","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714651,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"Hello","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714651,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"!","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" How","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" can","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" I","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" assist","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" you","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" today","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"?","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":" ","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"😊","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[{"delta":{"content":"","reasoning_content":null,"role":null,"tool_calls":null},"finish_reason":"stop","index":0,"logprobs":null,"matched_stop":1}],"created":1739714652,"id":"1392a93d52c3483ea872d0ab2aaff7d7","model":"DeepSeek-R1","object":"chat.completion.chunk","usage":null}\n`,
        `data: {"choices":[],"id":"79fca0de792a4ffb8ec836442a2a42c0","model":"DeepSeek-R1","usage":{"completion_tokens":16,"prompt_tokens":4,"total_tokens":20}}\n`,
        `data: [DONE]`,
      ];

      const transformer = createSSEDataExtractor();

      const results = await processChunk(transformer, stringToUint8Array(chunks.join('')));
      expect(results).matchSnapshot();
    });
  });
});

describe('createTokenSpeedCalculator', async () => {
  // Mock the param from caller - 1000 to avoid div 0
  const inputStartAt = Date.now() - 1000;

  // Helper function to process chunks through transformer
  const processChunk = async (transformer: TransformStream, chunk: any) => {
    const results: any[] = [];
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const writable = new WritableStream({
      write(chunk) {
        results.push(chunk);
      },
    });

    await readable.pipeThrough(transformer).pipeTo(writable);

    return results;
  };

  it('should calculate token speed correctly', async () => {
    const chunks = [
      { data: '', id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy', type: 'text' },
      { data: 'hi', id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy', type: 'text' },
      { data: 'stop', id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy', type: 'stop' },
      {
        data: {
          inputTextTokens: 9,
          outputTextTokens: 1,
          totalInputTokens: 9,
          totalOutputTokens: 1,
          totalTokens: 10,
        },
        id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy',
        type: 'usage',
      },
    ];

    const transformer = createTokenSpeedCalculator((v) => v, { inputStartAt });
    const results = await processChunk(transformer, chunks);
    expect(results).toHaveLength(chunks.length + 1);
    const speedChunk = results.at(-1);
    expect(speedChunk.id).toBe('output_speed');
    expect(speedChunk.type).toBe('speed');
    expect(speedChunk.data.tps).not.toBeNaN();
    expect(speedChunk.data.ttft).not.toBeNaN();
  });

  it('should not calculate token speed if no usage', async () => {
    const chunks = [
      { data: '', id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy', type: 'text' },
      { data: 'hi', id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy', type: 'text' },
      { data: 'stop', id: 'chatcmpl-BKO1bogylHvMaYfETjTAzrCguYwZy', type: 'stop' },
    ];

    const transformer = createTokenSpeedCalculator((v) => v, { inputStartAt });
    const results = await processChunk(transformer, chunks);
    expect(results).toHaveLength(chunks.length);
  });

  it('should calculate token speed considering outputImageTokens when totalOutputTokens is missing', async () => {
    const chunks = [
      { data: '', id: 'chatcmpl-image-1', type: 'text' },
      { data: 'hi', id: 'chatcmpl-image-1', type: 'text' },
      { data: 'stop', id: 'chatcmpl-image-1', type: 'stop' },
      {
        data: {
          inputTextTokens: 9,
          outputTextTokens: 1,
          outputImageTokens: 4,
          totalInputTokens: 9,
          // totalOutputTokens intentionally omitted to force summation path
          totalTokens: 13,
        },
        id: 'chatcmpl-image-1',
        type: 'usage',
      },
    ];

    const transformer = createTokenSpeedCalculator((v) => v, { inputStartAt });
    const results = await processChunk(transformer, chunks);

    // should push an extra speed chunk
    expect(results).toHaveLength(chunks.length + 1);
    const speedChunk = results.at(-1);
    expect(speedChunk.id).toBe('output_speed');
    expect(speedChunk.type).toBe('speed');
    // tps and ttft should be numeric (avoid flakiness if interval is 0ms)
    expect(speedChunk.data.tps).not.toBeNaN();
    expect(speedChunk.data.ttft).not.toBeNaN();
  });
});

describe('convertIterableToStream', () => {
  it('should surface errors from subsequent pulls as error chunks', async () => {
    async function* erroringStream() {
      yield 'first';
      throw new Error('rate limit');
    }

    const readable = convertIterableToStream(erroringStream()).pipeThrough(
      createFirstErrorHandleTransformer(),
    );

    const reader = readable.getReader();
    const chunks: any[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks[0]).toBe('first');
    expect(chunks[1][FIRST_CHUNK_ERROR_KEY]).toBe(true);
    expect(chunks[1].message).toBe('rate limit');
  });
});

describe('createSSEProtocolTransformer', () => {
  const processChunk = async (transformer: TransformStream, chunk: any) => {
    const results: any[] = [];
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const writable = new WritableStream({
      write(chunk) {
        results.push(chunk);
      },
    });

    await readable.pipeThrough(transformer).pipeTo(writable);

    return results;
  };

  it('should convert chunk into SSE formatted lines without enforcing terminal (default)', async () => {
    const transformerFn = (chunk: any) => ({ type: 'text', id: chunk.id, data: chunk.data });
    const transformer = createSSEProtocolTransformer(transformerFn as any);

    const input = { id: '1', data: 'hello' };
    const results = await processChunk(transformer, input);

    // Should only output the text event, no injected error on flush (default not enforced)
    expect(results).toEqual([`id: 1\n`, `event: text\n`, `data: ${JSON.stringify('hello')}\n\n`]);
  });

  it('should not emit flush error if a terminal event was received (enforced)', async () => {
    const transformerFn = (chunk: any) => ({ type: 'stop', id: chunk.id, data: chunk.data });
    const transformer = createSSEProtocolTransformer(
      transformerFn as any,
      { id: 'stream_ok' },
      { requireTerminalEvent: true },
    );

    const input = { id: 'ok', data: 'bye' };
    const results = await processChunk(transformer, input);

    // Only the stop event lines should be present (no extra error event from flush)
    expect(results).toEqual([`id: ok\n`, `event: stop\n`, `data: ${JSON.stringify('bye')}\n\n`]);
  });

  it('should emit an error event on flush when no terminal event received (enforced)', async () => {
    const transformerFn = (chunk: any) => ({ type: 'text', id: chunk.id, data: chunk.data });
    const streamStack = { id: 'stream_missing_term' } as any;
    const transformer = createSSEProtocolTransformer(transformerFn as any, streamStack, {
      requireTerminalEvent: true,
    });

    const input = { id: '1', data: 'partial' };
    const results = await processChunk(transformer, input);

    // original 3 lines + 3 lines from flush error
    expect(results).toHaveLength(6);

    // last three lines should be the injected error event
    const lastThree = results.slice(-3);
    const expectedData = {
      body: { name: 'Stream parsing error', reason: 'unexpected_end' },
      message: 'Stream ended unexpectedly',
      name: 'Stream parsing error',
      type: 'StreamChunkError',
    };

    expect(lastThree).toEqual([
      `id: ${streamStack.id}\n`,
      `event: error\n`,
      `data: ${JSON.stringify(expectedData)}\n\n`,
    ]);
  });
});

describe('createCallbacksTransformer', () => {
  // Helper function to process chunks through transformer
  const processChunks = async (
    transformer: TransformStream<string, Uint8Array>,
    chunks: string[],
  ) => {
    const results: Uint8Array[] = [];
    const readable = new ReadableStream<string>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        results.push(chunk);
      },
    });

    await readable.pipeThrough(transformer).pipeTo(writable);

    return results;
  };

  it('should call onStart callback when stream starts', async () => {
    const onStart = vi.fn();
    const transformer = createCallbacksTransformer({ onStart });

    await processChunks(transformer, []);

    expect(onStart).toHaveBeenCalledOnce();
  });

  it('should handle text chunks and call onText callback', async () => {
    const onText = vi.fn();
    const transformer = createCallbacksTransformer({ onText });

    const chunks = ['event: text\n', 'data: "Hello"\n\n', 'event: text\n', 'data: " World"\n\n'];

    await processChunks(transformer, chunks);

    expect(onText).toHaveBeenCalledTimes(2);
    expect(onText).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onText).toHaveBeenNthCalledWith(2, ' World');
  });

  it('should handle reasoning chunks and call onThinking callback', async () => {
    const onThinking = vi.fn();
    const transformer = createCallbacksTransformer({ onThinking });

    const chunks = [
      'event: reasoning\n',
      'data: "Let me think..."\n\n',
      'event: reasoning\n',
      'data: " about this"\n\n',
    ];

    await processChunks(transformer, chunks);

    expect(onThinking).toHaveBeenCalledTimes(2);
    expect(onThinking).toHaveBeenNthCalledWith(1, 'Let me think...');
    expect(onThinking).toHaveBeenNthCalledWith(2, ' about this');
  });

  it('should handle base64_image chunks and call onBase64Image callback', async () => {
    const receivedCalls: Array<{
      image: { id: string; data: string };
      images: Array<{ id: string; data: string }>;
    }> = [];
    const onBase64Image = vi.fn((data) => {
      // Clone the data to capture the state at call time
      receivedCalls.push({
        image: { ...data.image },
        images: [...data.images],
      });
    });
    const transformer = createCallbacksTransformer({ onBase64Image });

    const imageData1 = { image: { id: 'img1', data: 'base64data1' }, images: [] };
    const imageData2 = { image: { id: 'img2', data: 'base64data2' }, images: [] };

    const chunks = [
      'event: base64_image\n',
      `data: ${JSON.stringify(imageData1)}\n\n`,
      'event: base64_image\n',
      `data: ${JSON.stringify(imageData2)}\n\n`,
    ];

    await processChunks(transformer, chunks);

    expect(onBase64Image).toHaveBeenCalledTimes(2);
    // Check the captured state at each call time
    expect(receivedCalls[0]).toEqual({
      image: { id: 'img1', data: 'base64data1' },
      images: [{ id: 'img1', data: 'base64data1' }],
    });
    expect(receivedCalls[1]).toEqual({
      image: { id: 'img2', data: 'base64data2' },
      images: [
        { id: 'img1', data: 'base64data1' },
        { id: 'img2', data: 'base64data2' },
      ],
    });
  });

  it('should handle content_part chunks and call onContentPart callback', async () => {
    const onContentPart = vi.fn();
    const transformer = createCallbacksTransformer({ onContentPart });

    const partData = {
      content: 'Hello',
      partType: 'text',
      mimeType: 'text/plain',
      thoughtSignature: 'sig123',
    };

    const chunks = ['event: content_part\n', `data: ${JSON.stringify(partData)}\n\n`];

    await processChunks(transformer, chunks);

    expect(onContentPart).toHaveBeenCalledOnce();
    expect(onContentPart).toHaveBeenCalledWith({
      content: 'Hello',
      partType: 'text',
      mimeType: 'text/plain',
      thoughtSignature: 'sig123',
    });
  });

  it('should handle reasoning_part chunks and call onReasoningPart callback', async () => {
    const onReasoningPart = vi.fn();
    const transformer = createCallbacksTransformer({ onReasoningPart });

    const partData = {
      content: 'base64ImageData',
      partType: 'image',
      mimeType: 'image/png',
      inReasoning: true,
    };

    const chunks = ['event: reasoning_part\n', `data: ${JSON.stringify(partData)}\n\n`];

    await processChunks(transformer, chunks);

    expect(onReasoningPart).toHaveBeenCalledOnce();
    expect(onReasoningPart).toHaveBeenCalledWith({
      content: 'base64ImageData',
      partType: 'image',
      mimeType: 'image/png',
    });
  });

  it('should handle usage chunks and call onUsage callback', async () => {
    const onUsage = vi.fn();
    const transformer = createCallbacksTransformer({ onUsage });

    const usageData = {
      inputTextTokens: 10,
      outputTextTokens: 20,
      totalTokens: 30,
    };

    const chunks = ['event: usage\n', `data: ${JSON.stringify(usageData)}\n\n`];

    await processChunks(transformer, chunks);

    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(usageData);
  });

  it('should handle grounding chunks and call onGrounding callback', async () => {
    const onGrounding = vi.fn();
    const transformer = createCallbacksTransformer({ onGrounding });

    const groundingData = {
      sources: [{ url: 'https://example.com', title: 'Example' }],
    };

    const chunks = ['event: grounding\n', `data: ${JSON.stringify(groundingData)}\n\n`];

    await processChunks(transformer, chunks);

    expect(onGrounding).toHaveBeenCalledOnce();
    expect(onGrounding).toHaveBeenCalledWith(groundingData);
  });

  it('should handle tool_calls chunks and call onToolsCalling callback', async () => {
    const onToolsCalling = vi.fn();
    const transformer = createCallbacksTransformer({ onToolsCalling });

    const toolCallData = [
      {
        index: 0,
        id: 'call_123',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"SF"}' },
      },
    ];

    const chunks = ['event: tool_calls\n', `data: ${JSON.stringify(toolCallData)}\n\n`];

    await processChunks(transformer, chunks);

    expect(onToolsCalling).toHaveBeenCalledOnce();
    expect(onToolsCalling).toHaveBeenCalledWith({
      chunk: toolCallData,
      toolsCalling: expect.any(Array),
    });
  });

  it('should call onCompletion and onFinal callbacks on flush with aggregated data', async () => {
    const onCompletion = vi.fn();
    const onFinal = vi.fn();
    const transformer = createCallbacksTransformer({ onCompletion, onFinal });

    const chunks = [
      'event: text\n',
      'data: "Hello"\n\n',
      'event: text\n',
      'data: " World"\n\n',
      'event: reasoning\n',
      'data: "Thinking..."\n\n',
      'event: usage\n',
      `data: ${JSON.stringify({ totalTokens: 10 })}\n\n`,
    ];

    await processChunks(transformer, chunks);

    expect(onCompletion).toHaveBeenCalledOnce();
    expect(onFinal).toHaveBeenCalledOnce();

    const expectedData = {
      text: 'Hello World',
      thinking: 'Thinking...',
      usage: { totalTokens: 10 },
      grounding: undefined,
      speed: undefined,
      toolsCalling: undefined,
    };

    expect(onCompletion).toHaveBeenCalledWith(expectedData);
    expect(onFinal).toHaveBeenCalledWith(expectedData);
  });

  it('should handle speed chunks and include in final data', async () => {
    const onFinal = vi.fn();
    const transformer = createCallbacksTransformer({ onFinal });

    const speedData = { tps: 50, ttft: 100, duration: 500, latency: 600 };

    const chunks = [
      'event: text\n',
      'data: "Hi"\n\n',
      'event: speed\n',
      `data: ${JSON.stringify(speedData)}\n\n`,
    ];

    await processChunks(transformer, chunks);

    expect(onFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        speed: speedData,
      }),
    );
  });

  it('should work without any callbacks', async () => {
    const transformer = createCallbacksTransformer(undefined);

    const chunks = ['event: text\n', 'data: "Hello"\n\n'];

    // Should not throw
    await expect(processChunks(transformer, chunks)).resolves.toBeDefined();
  });

  it('should ignore invalid JSON data gracefully', async () => {
    const onText = vi.fn();
    const transformer = createCallbacksTransformer({ onText });

    const chunks = [
      'event: text\n',
      'data: invalid-json\n\n',
      'event: text\n',
      'data: "Valid"\n\n',
    ];

    await processChunks(transformer, chunks);

    // Only the valid JSON should trigger callback
    expect(onText).toHaveBeenCalledOnce();
    expect(onText).toHaveBeenCalledWith('Valid');
  });

  it('should handle multiple tool_calls chunks and accumulate them', async () => {
    const onToolsCalling = vi.fn();
    const transformer = createCallbacksTransformer({ onToolsCalling });

    const toolCall1 = [
      {
        index: 0,
        id: 'call_1',
        type: 'function',
        function: { name: 'func1', arguments: '' },
      },
    ];

    const toolCall2 = [
      {
        index: 0,
        function: { arguments: '{"a":1}' },
      },
    ];

    const chunks = [
      'event: tool_calls\n',
      `data: ${JSON.stringify(toolCall1)}\n\n`,
      'event: tool_calls\n',
      `data: ${JSON.stringify(toolCall2)}\n\n`,
    ];

    await processChunks(transformer, chunks);

    expect(onToolsCalling).toHaveBeenCalledTimes(2);
  });
});
