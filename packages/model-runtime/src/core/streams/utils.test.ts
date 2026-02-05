import { describe, expect, it } from 'vitest';

import { createReadableStream, readStreamChunk } from './utils';

describe('createReadableStream', () => {
  it('should create a readable stream from array of chunks', async () => {
    const chunks = ['chunk1', 'chunk2', 'chunk3'];
    const stream = createReadableStream(chunks);

    const reader = stream.getReader();
    const result: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    expect(result).toEqual(chunks);
  });

  it('should handle empty array', async () => {
    const stream = createReadableStream([]);
    const reader = stream.getReader();

    const { done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(true);
  });

  it('should handle different data types', async () => {
    const chunks = [1, 'string', { key: 'value' }, [1, 2, 3]];
    const stream = createReadableStream(chunks);

    const reader = stream.getReader();
    const result: any[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    expect(result).toEqual(chunks);
  });

  it('should close the stream after enqueuing all chunks', async () => {
    const chunks = ['test'];
    const stream = createReadableStream(chunks);

    const reader = stream.getReader();

    // Read the chunk
    const { done: firstDone, value } = await reader.read();
    expect(firstDone).toBe(false);
    expect(value).toBe('test');

    // Next read should indicate stream is closed
    const { done: secondDone } = await reader.read();
    expect(secondDone).toBe(true);

    reader.releaseLock();
  });
});

describe('readStreamChunk', () => {
  it('should read all chunks from a stream', async () => {
    const encoder = new TextEncoder();
    const testData = ['Hello ', 'world', '!'];

    const stream = new ReadableStream({
      start(controller) {
        testData.forEach((chunk) => {
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      },
    });

    const chunks = await readStreamChunk(stream);
    expect(chunks).toEqual(testData);
  });

  it('should handle empty stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const chunks = await readStreamChunk(stream);
    expect(chunks).toEqual([]);
  });

  it('should decode UTF-8 text correctly', async () => {
    const encoder = new TextEncoder();
    const testText = 'Hello 世界 🌍';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(testText));
        controller.close();
      },
    });

    const chunks = await readStreamChunk(stream);
    expect(chunks).toEqual([testText]);
  });

  it('should handle multiple chunks with streaming decode', async () => {
    const encoder = new TextEncoder();
    // Split a multi-byte character across chunks to test streaming decode
    const fullText = 'Hello 世界';
    const encoded = encoder.encode(fullText);
    const chunk1 = encoded.slice(0, 8); // Split in middle of multi-byte char
    const chunk2 = encoded.slice(8);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const chunks = await readStreamChunk(stream);
    expect(chunks.join('')).toBe(fullText);
  });

  it('should work with createReadableStream output', async () => {
    const encoder = new TextEncoder();
    const textChunks = ['chunk1', 'chunk2', 'chunk3'];
    const encodedChunks = textChunks.map((chunk) => encoder.encode(chunk));

    const stream = createReadableStream(encodedChunks);
    const result = await readStreamChunk(stream);

    expect(result).toEqual(textChunks);
  });

  it('should handle single large chunk', async () => {
    const encoder = new TextEncoder();
    const largeText = 'A'.repeat(10000);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(largeText));
        controller.close();
      },
    });

    const chunks = await readStreamChunk(stream);
    expect(chunks).toEqual([largeText]);
  });
});
