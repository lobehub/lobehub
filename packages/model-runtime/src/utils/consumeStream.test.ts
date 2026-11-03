import { describe, expect, it, vi } from 'vitest';

import { consumeStreamUntilDone } from './consumeStream';

describe('consumeStreamUntilDone', () => {
  it('should consume a stream completely', async () => {
    const chunks = ['chunk1', 'chunk2', 'chunk3'];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const response = new Response(stream);
    await consumeStreamUntilDone(response);

    // Stream should be consumed (reader should be locked and released)
    expect(response.body?.locked).toBe(false);
  });

  it('should handle response without body', async () => {
    const response = new Response(null);
    await expect(consumeStreamUntilDone(response)).resolves.toBeUndefined();
  });

  it('should release reader lock even when stream errors occur', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error('Stream error'));
      },
    });

    const response = new Response(stream);

    await expect(consumeStreamUntilDone(response)).rejects.toThrow('Stream error');

    // Reader lock should still be released
    expect(response.body?.locked).toBe(false);
  });

  it('should handle empty stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const response = new Response(stream);
    await expect(consumeStreamUntilDone(response)).resolves.toBeUndefined();
  });

  it('should consume stream with large number of chunks', async () => {
    const chunkCount = 100;
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < chunkCount; i++) {
          controller.enqueue(new TextEncoder().encode(`chunk${i}`));
        }
        controller.close();
      },
    });

    const response = new Response(stream);
    await expect(consumeStreamUntilDone(response)).resolves.toBeUndefined();
    expect(response.body?.locked).toBe(false);
  });

  it('should ensure reader.releaseLock is called', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('test'));
        controller.close();
      },
    });

    const response = new Response(stream);
    const reader = response.body!.getReader();
    const releaseLockSpy = vi.spyOn(reader, 'releaseLock');
    reader.releaseLock(); // Release the lock we just acquired

    await consumeStreamUntilDone(response);

    // The function should acquire a new reader and release it
    expect(releaseLockSpy).toHaveBeenCalled();
  });
});
