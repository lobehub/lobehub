import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PdfGenerationParams, usePdfGeneration } from './usePdfGeneration';

const mutateAsync = vi.fn();

vi.mock('@/libs/trpc/client/lambda', () => ({
  lambdaQuery: {
    exporter: {
      exportPdf: {
        useMutation: () => ({ mutateAsync }),
      },
    },
  },
}));

const params = (content: string): PdfGenerationParams => ({
  content,
  sessionId: 'agent-1',
  title: 'Topic',
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('usePdfGeneration', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it('renders only the latest request queued while one is in flight', async () => {
    const first = deferred<{ filename: string; pdf: string }>();
    mutateAsync
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ filename: 'c.pdf', pdf: 'pdf-c' });

    const { result } = renderHook(() => usePdfGeneration());

    let running!: Promise<void>;
    act(() => {
      running = result.current.generatePdf(params('a'));
    });
    act(() => {
      void result.current.generatePdf(params('b'));
      void result.current.generatePdf(params('c'));
    });

    await act(async () => {
      first.resolve({ filename: 'a.pdf', pdf: 'pdf-a' });
      await running;
    });

    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenLastCalledWith(params('c'));
    expect(result.current.pdfData).toBe('pdf-c');
    expect(result.current.loading).toBe(false);
  });

  it('keeps the previous PDF visible while a new one renders', async () => {
    mutateAsync.mockResolvedValueOnce({ filename: 'a.pdf', pdf: 'pdf-a' });
    const { result } = renderHook(() => usePdfGeneration());

    await act(() => result.current.generatePdf(params('a')));
    expect(result.current.pdfData).toBe('pdf-a');

    const next = deferred<{ filename: string; pdf: string }>();
    mutateAsync.mockImplementationOnce(() => next.promise);

    let running!: Promise<void>;
    act(() => {
      running = result.current.generatePdf(params('b'));
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.pdfData).toBe('pdf-a');

    await act(async () => {
      next.resolve({ filename: 'b.pdf', pdf: 'pdf-b' });
      await running;
    });

    expect(result.current.pdfData).toBe('pdf-b');
  });

  it('reports a failure of the latest request', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => usePdfGeneration());

    await act(() => result.current.generatePdf(params('a')));

    expect(result.current.error).toBe('boom');
    expect(result.current.loading).toBe(false);
  });
});
