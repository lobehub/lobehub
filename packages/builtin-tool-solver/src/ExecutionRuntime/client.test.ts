import { describe, expect, it, vi } from 'vitest';

import { SolverServiceClient, SolverServiceError } from './client';

const BASE_URL = 'https://solver.example.com';
const API_KEY = 'super-secret-test-key';

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  }) as Response;

const createClient = (fetchFn: typeof fetch, timeoutMs?: number) =>
  new SolverServiceClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetchFn, timeoutMs });

const solveBody = { queryId: 'validation_0', spec: { budget: 2000 } };

describe('SolverServiceClient', () => {
  it('refuses to construct without configuration', () => {
    expect(() => new SolverServiceClient({ apiKey: '', baseUrl: BASE_URL })).toThrowError(
      SolverServiceError,
    );
    expect(() => new SolverServiceClient({ apiKey: API_KEY, baseUrl: '' })).toThrowError(
      /not configured/,
    );
  });

  it('posts to the pack solve endpoint with bearer auth', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'optimal' }));
    const client = createClient(fetchFn as unknown as typeof fetch);

    const result = await client.solve('travelplanner', solveBody);

    expect(result).toEqual({ status: 'optimal' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://solver.example.com/v1/packs/travelplanner/solve');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(solveBody);
  });

  it('posts to the pack verify endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { pass: true, results: [] }));
    const client = createClient(fetchFn as unknown as typeof fetch);

    await client.verify('travelplanner', { ...solveBody, plan: [] });

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://solver.example.com/v1/packs/travelplanner/verify');
  });

  it('strips a trailing slash from the base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'optimal' }));
    const client = new SolverServiceClient({
      apiKey: API_KEY,
      baseUrl: `${BASE_URL}/`,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await client.solve('travelplanner', solveBody);

    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://solver.example.com/v1/packs/travelplanner/solve');
  });

  it.each([
    { expectedType: 'unauthorized', status: 401 },
    { expectedType: 'unauthorized', status: 403 },
    { expectedType: 'unknown_pack', status: 404 },
    { expectedType: 'request_too_large', status: 413 },
    { expectedType: 'service_error', status: 500 },
    { expectedType: 'service_error', status: 502 },
  ])(
    'maps HTTP $status to a "$expectedType" error that never leaks the key',
    async ({ status, expectedType }) => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(status, { detail: 'server detail' }));
      const client = createClient(fetchFn as unknown as typeof fetch);

      const error = await client.solve('travelplanner', solveBody).catch((e) => e);

      expect(error).toBeInstanceOf(SolverServiceError);
      expect((error as SolverServiceError).type).toBe(expectedType);
      expect((error as SolverServiceError).status).toBe(status);
      expect((error as SolverServiceError).message).not.toContain(API_KEY);
      expect(JSON.stringify(error)).not.toContain(API_KEY);
    },
  );

  it('maps HTTP 400 to bad_request and surfaces the service detail', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { detail: 'unknown queryId "validation_999"' }));
    const client = createClient(fetchFn as unknown as typeof fetch);

    const error = await client.solve('travelplanner', solveBody).catch((e) => e);

    expect(error).toBeInstanceOf(SolverServiceError);
    expect((error as SolverServiceError).type).toBe('bad_request');
    expect((error as SolverServiceError).message).toContain('unknown queryId');
    expect((error as SolverServiceError).message).not.toContain(API_KEY);
  });

  it('maps network failures to a network error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createClient(fetchFn as unknown as typeof fetch);

    const error = await client.solve('travelplanner', solveBody).catch((e) => e);

    expect(error).toBeInstanceOf(SolverServiceError);
    expect((error as SolverServiceError).type).toBe('network');
    expect((error as SolverServiceError).message).toContain('Cannot reach the solver service');
    expect((error as SolverServiceError).message).not.toContain(API_KEY);
  });

  it('maps an abort of the built-in timeout to a timeout error', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation timed out.', 'TimeoutError')),
          );
        }),
    );
    const client = createClient(fetchFn as unknown as typeof fetch, 10);

    const error = await client.solve('travelplanner', solveBody).catch((e) => e);

    expect(error).toBeInstanceOf(SolverServiceError);
    expect((error as SolverServiceError).type).toBe('timeout');
    expect((error as SolverServiceError).message).toContain('10 ms');
  });

  it('maps a caller-side abort to an aborted error', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const client = createClient(fetchFn as unknown as typeof fetch);
    const controller = new AbortController();

    const promise = client.solve('travelplanner', solveBody, { signal: controller.signal });
    controller.abort();

    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(SolverServiceError);
    expect((error as SolverServiceError).type).toBe('aborted');
  });
});
