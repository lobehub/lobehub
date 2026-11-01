import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootTiming } from './index';

const resetState = () => {
  (bootTiming as unknown as { _reset: () => void })._reset();
};

beforeEach(() => {
  resetState();
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bootTiming', () => {
  it('span records name/startMs/durMs and returns fn value', async () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(10).mockReturnValueOnce(25);

    const result = await bootTiming.span('init', () => 'ok');

    expect(result).toBe('ok');
    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ durMs: 15, name: 'init', startMs: 10 });
  });

  it('span with async fn awaits and times full duration', async () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(5).mockReturnValueOnce(30);

    const result = await bootTiming.span('fetch', async () => 42);

    expect(result).toBe(42);
    const { spans } = bootTiming.snapshot();
    expect(spans[0]).toEqual({ durMs: 25, name: 'fetch', startMs: 5 });
  });

  it('span records span even when fn throws, and rethrows the error', async () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(2).mockReturnValueOnce(8);

    const err = new Error('boom');
    await expect(
      bootTiming.span('bad', () => {
        throw err;
      }),
    ).rejects.toThrow(err);

    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ durMs: 6, name: 'bad', startMs: 2 });
  });

  it('mark + measure derive a span with correct startMs/durMs', () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(100).mockReturnValueOnce(250);

    bootTiming.mark('a');
    bootTiming.mark('b');
    bootTiming.measure('a-to-b', 'a', 'b');

    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ durMs: 150, name: 'a-to-b', startMs: 100 });
  });

  it('measure with a missing mark is a no-op', () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(10);

    bootTiming.mark('a');
    expect(() => bootTiming.measure('a-to-b', 'a', 'missing')).not.toThrow();

    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(0);
  });

  it('recordSpan appends a span verbatim', () => {
    bootTiming.recordSpan('resource', 50, 20);
    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ durMs: 20, name: 'resource', startMs: 50 });
  });

  it('spanSync records name/startMs/durMs and returns fn value', () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(10).mockReturnValueOnce(25);

    const result = bootTiming.spanSync('sync-init', () => 'ok');

    expect(result).toBe('ok');
    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ durMs: 15, name: 'sync-init', startMs: 10 });
  });

  it('spanSync records span even when fn throws, and rethrows the error', () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(2).mockReturnValueOnce(8);

    const err = new Error('boom');
    expect(() =>
      bootTiming.spanSync('sync-bad', () => {
        throw err;
      }),
    ).toThrow(err);

    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ durMs: 6, name: 'sync-bad', startMs: 2 });
  });

  it('measure with fromMark absent is a no-op', () => {
    const nowMock = vi.spyOn(performance, 'now');
    nowMock.mockReturnValueOnce(10);

    bootTiming.mark('b');
    expect(() => bootTiming.measure('a-to-b', 'missing', 'b')).not.toThrow();

    const { spans } = bootTiming.snapshot();
    expect(spans).toHaveLength(0);
  });

  it('snapshot returns copies — mutating returned data does not affect internal state', () => {
    bootTiming.recordSpan('x', 1, 2);
    bootTiming.mark('m');

    const snap1 = bootTiming.snapshot();
    snap1.spans.push({ durMs: 99, name: 'injected', startMs: 0 });
    snap1.marks['m'] = 9999;

    const snap2 = bootTiming.snapshot();
    expect(snap2.spans).toHaveLength(1);
    expect(snap2.marks['m']).not.toBe(9999);
  });
});
