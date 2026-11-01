import type { CanvasRuntimeBundle } from '@lobechat/canvas/runtime';
import { describe, expect, it } from 'vitest';

import { CanvasRuntimeManager } from './CanvasRuntimeManager';
import type { CanvasRuntimeSource } from './CanvasRuntimeSource';

const source = (load: () => Promise<CanvasRuntimeBundle>): CanvasRuntimeSource => {
  const values = new Set<CanvasRuntimeBundle>();
  let disposed = false;
  const clear = (value: CanvasRuntimeBundle) => {
    value.modules.length = 0;
    value.styles.length = 0;
  };
  return {
    async load() {
      const value = await load();
      if (disposed) clear(value);
      else values.add(value);
      return value;
    },
    dispose() {
      disposed = true;
      for (const value of values) clear(value);
      values.clear();
    },
  };
};

const bundle = (): CanvasRuntimeBundle => ({
  entries: { runtime: 'entry.js', highlight: 'highlight.js', mermaid: 'mermaid.js' },
  modules: [
    {
      id: 'entry.js',
      code: 'globalThis.ready = true',
      imports: [],
      url: 'https://app.test/entry.js',
    },
  ],
  styles: ['body { color: red }'],
});

describe('CanvasRuntimeManager', () => {
  it('shares one load and keeps it alive until the last Canvas releases it', async () => {
    let loads = 0;
    let signal: AbortSignal | undefined;
    const manager = new CanvasRuntimeManager((nextSignal) =>
      source(async () => {
        loads++;
        signal = nextSignal;
        return bundle();
      }),
    );
    const first = manager.acquire();
    const second = manager.acquire();
    const content = await first.ready;
    expect(await second.ready).toBe(content);
    expect(loads).toBe(1);

    first.release();
    first.release();
    expect(signal?.aborted).toBe(false);
    expect(content.modules).toHaveLength(1);

    second.release();
    expect(signal?.aborted).toBe(true);
    expect(content.modules).toEqual([]);
    expect(content.styles).toEqual([]);
    const third = manager.acquire();
    expect((await third.ready).modules).toHaveLength(1);
    expect(loads).toBe(2);
    third.release();
  });

  it('disposes a late completion after close without clearing a newer Canvas load', async () => {
    let complete: ((value: CanvasRuntimeBundle) => void) | undefined;
    const pending = new Promise<CanvasRuntimeBundle>((resolve) => {
      complete = resolve;
    });
    let loads = 0;
    const manager = new CanvasRuntimeManager(() => {
      const next = ++loads === 1 ? pending : Promise.resolve(bundle());
      return source(() => next);
    });
    const old = manager.acquire();
    old.release();
    const current = manager.acquire();
    const live = await current.ready;
    const stale = bundle();
    complete!(stale);
    await old.ready;
    expect(stale.modules).toEqual([]);
    expect(live.modules).toHaveLength(1);
    current.release();
  });

  it('allows a fresh load after the last failed lease is released', async () => {
    let loads = 0;
    const manager = new CanvasRuntimeManager(() =>
      source(async () => {
        if (++loads === 1) throw new Error('offline');
        return bundle();
      }),
    );
    const failed = manager.acquire();
    await expect(failed.ready).rejects.toThrow('offline');
    failed.release();
    const retry = manager.acquire();
    expect((await retry.ready).modules).toHaveLength(1);
    retry.release();
  });
});
