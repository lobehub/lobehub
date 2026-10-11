// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBflImage } from './createImage';

const pollingUrl = 'https://api.bfl.test/result?id=original-job';
const payload = { model: 'flux-dev', params: { prompt: 'A landscape' } };
const options = { apiKey: 'test-key', baseURL: 'https://api.bfl.test', provider: 'bfl' };
let requests: { url: string; method: string }[];

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function serveStatus(status: (request: RequestInit | undefined) => Promise<Response> | Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET' });
      if (init?.method === 'POST')
        return Response.json({ id: 'original-job', polling_url: pollingUrl });
      return status(init);
    }),
  );
}

function expectOriginalJobOnly() {
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  expect(
    requests
      .filter((request) => request.method === 'GET')
      .every((request) => request.url === pollingUrl),
  ).toBe(true);
}

describe('BFL accepted-job recovery', () => {
  it('recovers the original output after more than three transient status failures', async () => {
    let attempt = 0;
    serveStatus(() => {
      attempt++;
      if (attempt === 1) throw new TypeError('fetch failed');
      if (attempt <= 4) return Response.json({}, { status: attempt === 3 ? 429 : 503 });
      return Response.json({
        status: 'Ready',
        result: { sample: 'https://cdn.test/original.png' },
      });
    });
    const result = createBflImage(payload, options);
    const assertion = expect(result).resolves.toEqual({
      imageUrl: 'https://cdn.test/original.png',
    });
    await Promise.all([assertion, vi.advanceTimersByTimeAsync(15_000)]);
    expectOriginalJobOnly();
  });

  it.each([400, 401, 403, 404])(
    'does not retry permanent HTTP %s status failures',
    async (status) => {
      serveStatus(() => Response.json({}, { status }));
      await expect(createBflImage(payload, options)).rejects.toMatchObject({
        error: expect.objectContaining({ message: expect.stringContaining(String(status)) }),
      });
      expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
      expectOriginalJobOnly();
    },
  );

  it.each(['Error', 'Content Moderated', 'Request Moderated', 'Task not found'])(
    'reports the terminal job state %s without retrying',
    async (status) => {
      serveStatus(() => Response.json({ status }));
      await expect(createBflImage(payload, options)).rejects.toMatchObject({
        errorType: 'ProviderBizError',
      });
      expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
      expectOriginalJobOnly();
    },
  );

  it.each(['offline', 'pending', 'stalled'])(
    'bounds %s tracking and stops requests without resubmission',
    async (mode) => {
      serveStatus((init) => {
        if (mode === 'offline') throw new TypeError('fetch failed');
        if (mode === 'pending') return Response.json({ status: 'Pending' });
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      });
      const result = createBflImage(payload, options);
      const assertion = expect(result).rejects.toMatchObject({
        error: expect.objectContaining({
          message: expect.stringContaining('may still be running'),
        }),
      });
      await Promise.all([assertion, vi.advanceTimersByTimeAsync(245_000)]);
      expectOriginalJobOnly();
      const count = requests.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(requests).toHaveLength(count);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not resubmit when the submission response is lost', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    await expect(createBflImage(payload, options)).rejects.toMatchObject({
      errorType: 'ProviderBizError',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
