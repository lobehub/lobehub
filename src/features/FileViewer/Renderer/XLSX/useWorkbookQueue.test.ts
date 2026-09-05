/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useWorkbookQueue } from './useWorkbookQueue';

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const decode = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const setup = () => {
  const changes: string[] = [];
  const onError = vi.fn();
  const { result } = renderHook(() =>
    useWorkbookQueue(async (bytes) => {
      changes.push(decode(bytes));
    }, onError),
  );
  result.current.initialize(encode('base'));
  return { changes, onError, queue: result.current };
};

describe('useWorkbookQueue', () => {
  it('serializes overlapping edits so a fast second edit builds on the slow first one', async () => {
    const { changes, queue } = setup();

    // Fired back-to-back without awaiting; the first edit is slower. Without
    // serialization both would read 'base' and the first edit would be lost.
    const first = queue.apply(async (current) => {
      await delay(30);
      return encode(`${decode(current)}+a`);
    });
    const second = queue.apply(async (current) => encode(`${decode(current)}+b`));
    await Promise.all([first, second]);

    expect(changes).toEqual(['base+a', 'base+a+b']);
  });

  it('runs undo/redo through the same queue against the latest bytes', async () => {
    const { changes, queue } = setup();

    void queue.apply(async (current) => encode(`${decode(current)}+a`));
    void queue.apply(async (current) => encode(`${decode(current)}+b`));
    void queue.undo();
    await queue.redo();

    expect(changes).toEqual(['base+a', 'base+a+b', 'base+a', 'base+a+b']);
  });

  it('lets save/export read bytes only after all pending edits settle', async () => {
    const { queue } = setup();

    void queue.apply(async (current) => {
      await delay(20);
      return encode(`${decode(current)}+edit`);
    });
    const exported = vi.fn();
    await queue.withCurrent((current) => exported(decode(current)));

    expect(exported).toHaveBeenCalledWith('base+edit');
  });

  it('keeps accepting operations after a failed edit', async () => {
    const { changes, onError, queue } = setup();

    await queue.apply(async () => {
      throw new Error('corrupt operation');
    });
    await queue.apply(async (current) => encode(`${decode(current)}+ok`));

    // The failed edit pushed history but produced no bytes; the next edit still
    // starts from the last good state.
    expect(changes).toEqual(['base+ok']);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'corrupt operation' }));
  });
});
