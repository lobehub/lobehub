import { describe, expect, it, vi } from 'vitest';

import { readBlobWithLimit } from './readBlobWithLimit';

describe('readBlobWithLimit stream cleanup', () => {
  it('releases the reader after a successful download', async () => {
    const response = new Response('hello', { headers: { 'content-type': 'text/plain' } });
    const blob = await readBlobWithLimit(response, 5);
    expect(await blob.text()).toBe('hello');
    expect(blob.type).toBe('text/plain');
    expect(response.body?.locked).toBe(false);
  });

  it('keeps the limit error when transport cancellation rejects', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('transport disconnected'));
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(6));
      },
    });
    const response = new Response(stream);

    await expect(readBlobWithLimit(response, 5)).rejects.toThrow(RangeError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('releases the reader after a network failure', async () => {
    const failure = new Error('connection reset');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    await expect(readBlobWithLimit(new Response(stream), 5)).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });
});
