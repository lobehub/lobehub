import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTextFileLoader } from './useTextFileLoader';

// ROOT CAUSE:
// Text preview used response.text() without byte validation, size limits, or request cancellation.
// Unknown extensions never reached this path, and binary/failed/empty loads could show blank editors
// or permanent spinners. Byte-based loading provides a format-independent fallback.
/** @example Original text, unsupported bytes, and failures resolve into distinct preview states. */
describe('useTextFileLoader', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** @example An unknown suffix does not prevent Unicode source from being previewed. */
  it('loads original text without a recognized extension or MIME', async () => {
    const content = '<tag>日本語</tag>\n  source { value: 1 }';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(content)));
    const { result } = renderHook(() => useTextFileLoader('/source.unrecognized'));
    await waitFor(() => {
      /** @example Whitespace and markup are preserved verbatim. */
      expect(result.current.fileData).toBe(content);
    });
  });

  /** @example Empty uploads are successful previews, not perpetual loading. */
  it('finishes loading an empty file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
    const { result } = renderHook(() => useTextFileLoader('/empty'));
    await waitFor(() => {
      /** @example Empty content is distinguishable from unsupported content. */
      expect(result.current).toMatchObject({ error: null, fileData: '', loading: false });
    });
  });

  /** @example Binary data falls back to file download. */
  it('does not decode binary bytes as source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 0, 1, 2, 3]))),
    );
    const { result } = renderHook(() => useTextFileLoader('/binary'));
    await waitFor(() => {
      /** @example Unsupported bytes complete loading without text. */
      expect(result.current).toMatchObject({ error: null, fileData: null, loading: false });
    });
  });

  /** @example UTF-16 bytes are text despite containing null bytes. */
  it('decodes a supported non-UTF-8 encoding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array([255, 254, 65, 0, 66, 0]))),
    );
    const { result } = renderHook(() => useTextFileLoader('/encoded'));
    await waitFor(() => {
      /** @example UTF-16LE BOM selects the appropriate decoder. */
      expect(result.current.fileData).toBe('AB');
    });
  });

  /** @example A server cannot bypass preview limits by omitting Content-Length. */
  it('stops oversized streamed downloads', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const { result } = renderHook(() => useTextFileLoader('/large'));
    await waitFor(() => {
      /** @example Oversized files settle into the download fallback and stop the stream. */
      expect(result.current).toMatchObject({ error: null, fileData: null, loading: false });
      expect(cancel).toHaveBeenCalled();
    });
  });

  /** @example Failed reads remain visible as errors alongside the download fallback. */
  it('reports HTTP errors and ends loading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    const { result } = renderHook(() => useTextFileLoader('/denied'));
    await waitFor(() => {
      /** @example Failed requests do not leave a permanent spinner. */
      expect(result.current.loading).toBe(false);
      expect(result.current.error?.message).toContain('403');
    });
  });

  /** @example Navigation prevents an older request from replacing the newly opened file. */
  it('ignores stale responses after switching files', async () => {
    let resolveFirst!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response('new content'));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ url }) => useTextFileLoader(url), {
      initialProps: { url: '/old' },
    });
    rerender({ url: '/new' });
    await waitFor(() => {
      /** @example The latest file wins. */
      expect(result.current.fileData).toBe('new content');
    });
    await act(async () => {
      resolveFirst(new Response('old content'));
    });
    /** @example A late response cannot overwrite the active file. */
    expect(result.current.fileData).toBe('new content');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
