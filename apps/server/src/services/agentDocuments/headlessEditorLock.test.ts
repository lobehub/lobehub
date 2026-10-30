// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { withHeadlessEditorLock } from './headlessEditor';

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('withHeadlessEditorLock', () => {
  it('runs one holder at a time', async () => {
    const events: string[] = [];
    const hold = (name: string) =>
      withHeadlessEditorLock(async () => {
        events.push(`${name}:start`);
        await tick();
        events.push(`${name}:end`);
      });

    await Promise.all([hold('a'), hold('b')]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets a holder take the lock again instead of waiting on itself', async () => {
    const result = await withHeadlessEditorLock(() =>
      withHeadlessEditorLock(async () => {
        await tick();
        return 'nested';
      }),
    );

    expect(result).toBe('nested');
  });

  it('releases the lock when a holder throws', async () => {
    await expect(
      withHeadlessEditorLock(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await withHeadlessEditorLock(() => 'next')).toBe('next');
  });
});
