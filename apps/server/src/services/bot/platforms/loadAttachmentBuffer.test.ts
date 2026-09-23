// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCappedBuffer,
  fetchCappedBufferWithDetail,
  loadAttachmentBuffer,
  loadAttachmentBufferWithDetail,
} from './loadAttachmentBuffer';
import type * as PublicUrlFetch from './publicUrlFetch';

// These tests stub `fetch` directly; the SSRF guard in front of it resolves DNS
// for real, which has nothing to do with what they assert. Its own behaviour is
// covered in publicUrlFetch.test.ts.
vi.mock('./publicUrlFetch', async () => ({
  // Real redaction — a stub here would let a leaking log line pass the test
  // that exists to catch exactly that.
  ...(await vi.importActual<typeof PublicUrlFetch>('./publicUrlFetch')),
  fetchPublicUrl: async (url: string, timeoutMs: number) => ({
    dispose: async () => undefined,
    response: await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }),
  }),
}));

const streamOf = (chunks: Uint8Array[], cancel = vi.fn()) => {
  let i = 0;
  return {
    getReader: () => ({
      cancel,
      read: async () =>
        i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
    }),
  };
};

const responseOf = (chunks: Uint8Array[], headers: Record<string, string> = {}, cancel?: any) =>
  ({ body: streamOf(chunks, cancel), headers: new Headers(headers), ok: true, status: 200 }) as any;

describe('fetchCappedBuffer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the body when it fits the cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseOf([new Uint8Array([1, 2, 3])])));

    expect(await fetchCappedBuffer('https://x/f', { limit: 100 })).toEqual(Buffer.from([1, 2, 3]));
  });

  it('reassembles multi-chunk bodies in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          responseOf([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]),
        ),
    );

    expect(await fetchCappedBuffer('https://x/f', { limit: 100 })).toEqual(
      Buffer.from([1, 2, 3, 4, 5]),
    );
  });

  it('grows past its initial capacity without corrupting the bytes', async () => {
    // No content-length, so the read starts small and has to grow repeatedly.
    const chunks = Array.from({ length: 40 }, (_, i) => new Uint8Array(4096).fill(i));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseOf(chunks)));

    const buffer = await fetchCappedBuffer('https://x/f', { limit: 10 * 1024 * 1024 });

    expect(buffer).toHaveLength(40 * 4096);
    expect(buffer!.subarray(0, 4096).every((b) => b === 0)).toBe(true);
    expect(buffer!.subarray(39 * 4096).every((b) => b === 39)).toBe(true);
  });

  it('rejects on content-length without reading the body at all', async () => {
    const getReader = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: { getReader },
        headers: new Headers({ 'content-length': '999' }),
        ok: true,
        status: 200,
      }),
    );

    expect(await fetchCappedBuffer('https://x/f', { limit: 100 })).toBeUndefined();
    expect(getReader).not.toHaveBeenCalled();
  });

  it('cancels the transfer when a size-less body streams past the cap', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(responseOf([new Uint8Array(80), new Uint8Array(80)], {}, cancel)),
    );

    expect(await fetchCappedBuffer('https://x/f', { limit: 100 })).toBeUndefined();
    expect(cancel).toHaveBeenCalled();
  });

  it('returns undefined on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    expect(await fetchCappedBuffer('https://x/f', { limit: 100 })).toBeUndefined();
  });

  it('returns undefined instead of throwing when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    expect(await fetchCappedBuffer('https://x/f', { limit: 100 })).toBeUndefined();
  });
});

describe('loadAttachmentBuffer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers inline base64 over a round-trip', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const buffer = await loadAttachmentBuffer(
      { data: Buffer.from('hi').toString('base64'), fetchUrl: 'https://x/f' },
      { limit: 100 },
    );

    expect(buffer).toEqual(Buffer.from('hi'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies the same cap to inline base64, without falling back to the URL', async () => {
    // The inline copy IS the attachment — re-fetching it would be just as big.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const buffer = await loadAttachmentBuffer(
      { data: Buffer.alloc(200).toString('base64'), fetchUrl: 'https://x/f' },
      { limit: 100 },
    );

    expect(buffer).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to fetchUrl when there is no inline data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseOf([new Uint8Array([7])])));

    expect(await loadAttachmentBuffer({ fetchUrl: 'https://x/f' }, { limit: 100 })).toEqual(
      Buffer.from([7]),
    );
  });

  it('returns undefined when the attachment carries no source', async () => {
    expect(await loadAttachmentBuffer({}, { limit: 100 })).toBeUndefined();
  });
});

describe('loadAttachmentBufferWithDetail', () => {
  // The bare `undefined` these loaders used to return is how a whole-platform
  // download regression stayed invisible: the senders could not tell a broken
  // fetch from a missing source. The reason has to survive to the boundary.
  afterEach(() => vi.unstubAllGlobals());

  it('surfaces the fetch error AND its cause — that is where undici puts the diagnosis', async () => {
    const error = new TypeError('fetch failed');
    (error as any).cause = new TypeError('Invalid IP address: undefined');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

    const result = await fetchCappedBufferWithDetail('https://x/f', { limit: 100 });

    expect(result.buffer).toBeUndefined();
    expect(result.error).toBe('fetch failed: fetch failed (Invalid IP address: undefined)');
  });

  it('reports the cause code rather than its message when the cause carries one', async () => {
    // A system error message names the resolved host:port — for a trusted
    // origin that is our own storage address, which must not reach the model.
    const error = new TypeError('fetch failed');
    (error as any).cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.12:9000'), {
      code: 'ECONNREFUSED',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

    const result = await fetchCappedBufferWithDetail('https://x/f', { limit: 100 });

    expect(result.error).toBe('fetch failed: fetch failed (ECONNREFUSED)');
    expect(result.error).not.toContain('10.0.0.12');
  });

  it('reports the HTTP status of a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    expect(await fetchCappedBufferWithDetail('https://x/f', { limit: 100 })).toEqual({
      error: 'HTTP 403',
    });
  });

  it('reports the advertised size when content-length exceeds the cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseOf([], { 'content-length': '5000' })));

    expect(await fetchCappedBufferWithDetail('https://x/f', { limit: 100 })).toEqual({
      error: 'content-length 5000 exceeds the 100 byte cap',
    });
  });

  it('reports oversize inline data without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadAttachmentBufferWithDetail(
      { data: Buffer.alloc(200).toString('base64'), fetchUrl: 'https://x/f' },
      { limit: 100 },
    );

    expect(result).toEqual({ error: '200 inline bytes exceed the 100 byte cap' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an attachment with no source at all', async () => {
    expect(await loadAttachmentBufferWithDetail({})).toEqual({
      error: 'attachment carries neither data nor fetchUrl',
    });
  });

  it('hands back the bytes when the source is usable', async () => {
    expect(
      await loadAttachmentBufferWithDetail({ data: Buffer.from('ok').toString('base64') }),
    ).toEqual({
      buffer: Buffer.from('ok'),
    });
  });
});
