import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLobeHub, LobeHubConnectionError, LobeHubTimeoutError } from './index';
import { backoffDelay, parseRetryAfter } from './transport';

const ok = () =>
  new Response(JSON.stringify({ data: {}, success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ code: `http_${code}`, message: 'x', success: false }), {
    headers: { 'Content-Type': 'application/json', ...headers },
    status: code,
  });

/** Answer each call from `script` in order (the last entry repeats). */
const scripted = (script: Array<() => Response | Promise<Response>>) => {
  const calls: Array<{ at: number; request: Request; signal?: AbortSignal | null }> = [];
  const fetch = (async (request: Request, init?: RequestInit) => {
    calls.push({ at: Date.now(), request, signal: init?.signal });
    return script[Math.min(calls.length - 1, script.length - 1)]();
  }) as typeof globalThis.fetch;
  return { calls, fetch };
};

describe('retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 429 after the Retry-After seconds', async () => {
    const { calls, fetch } = scripted([() => status(429, { 'Retry-After': '2' }), ok]);
    const lobehub = createLobeHub({ apiKey: 'k', fetch });

    const pending = lobehub.agents.list();
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const { error } = await pending;

    expect(error).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1].at - calls[0].at).toBe(2000);
  });

  it('does not retry a streaming POST even though it carries an idempotency key', async () => {
    const { calls, fetch } = scripted([() => status(503), ok]);
    const lobehub = createLobeHub({ apiKey: 'k', fetch, maxRetries: 3 });

    const iterate = async () => {
      for await (const _ of lobehub.responses.stream(
        { input: 'hi', model: 'agt_1' },
        { idempotencyKey: 'run-1' },
      )) {
        // the first attempt fails before any event arrives
      }
    };

    await expect(iterate()).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);
    expect(calls[0].request.headers.get('Idempotency-Key')).toBe('run-1');
  });

  it('backs off exponentially on 5xx and gives up after maxRetries', async () => {
    const { calls, fetch } = scripted([() => status(503)]);
    const lobehub = createLobeHub({ apiKey: 'k', fetch, maxRetries: 3 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter

    const pending = lobehub.agents.list();
    await vi.runAllTimersAsync();
    const { error, response } = await pending;

    expect(response?.status).toBe(503);
    expect(error).toMatchObject({ status: 503 });
    expect(calls).toHaveLength(4);
    expect(calls.slice(1).map((call, index) => call.at - calls[index].at)).toEqual([
      500, 1000, 2000,
    ]);
  });

  it('retries network failures of idempotent requests', async () => {
    let attempt = 0;
    const fetch = (async () => {
      if (++attempt < 3) throw new TypeError('fetch failed');
      return ok();
    }) as typeof globalThis.fetch;
    const lobehub = createLobeHub({ apiKey: 'k', fetch });

    const pending = lobehub.agents.delete({ path: { id: 'agt_1' } });
    await vi.runAllTimersAsync();

    expect((await pending).error).toBeUndefined();
    expect(attempt).toBe(3);
  });

  it('does not retry 4xx answers other than 408/429', async () => {
    const { calls, fetch } = scripted([() => status(404)]);
    await createLobeHub({ apiKey: 'k', fetch }).agents.list();
    expect(calls).toHaveLength(1);
  });

  it('honors a per-call maxRetries', async () => {
    const { calls, fetch } = scripted([() => status(500)]);
    const lobehub = createLobeHub({ apiKey: 'k', fetch, maxRetries: 5 });

    const pending = lobehub.agents.list({ maxRetries: 1 });
    await vi.runAllTimersAsync();
    await pending;

    expect(calls).toHaveLength(2);
  });

  it('returns the answer instead of waiting out a long Retry-After', async () => {
    const { calls, fetch } = scripted([() => status(429, { 'Retry-After': '3600' }), ok]);
    const { response } = await createLobeHub({ apiKey: 'k', fetch }).agents.list();

    expect(response?.status).toBe(429);
    expect(calls).toHaveLength(1);
  });
});

describe('timeout', () => {
  /** A fetch that only settles when its signal aborts. */
  const hanging = (() => {
    const fetch = ((_request: Request, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof globalThis.fetch;
    return fetch;
  })();

  it('fails a request without response headers within `timeout`', async () => {
    const lobehub = createLobeHub({ apiKey: 'k', fetch: hanging, maxRetries: 0, timeout: 20 });

    const { error } = await lobehub.agents.list();

    expect(error).toBeInstanceOf(LobeHubTimeoutError);
    expect(error).toBeInstanceOf(LobeHubConnectionError);
    expect((error as unknown as LobeHubTimeoutError).timeout).toBe(20);
  });

  it('applies a per-call timeout and retries a timed-out GET', async () => {
    let attempts = 0;
    const fetch = ((request: Request, init?: RequestInit) => {
      attempts++;
      return attempts === 1 ? hanging(request, init) : Promise.resolve(ok());
    }) as typeof globalThis.fetch;
    const lobehub = createLobeHub({ apiKey: 'k', fetch, timeout: 60_000 });

    const { error } = await lobehub.agents.list({ timeout: 10 });

    expect(error).toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('leaves a caller abort as an AbortError without retrying', async () => {
    let attempts = 0;
    const fetch = ((request: Request, init?: RequestInit) => {
      attempts++;
      return hanging(request, init);
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    const lobehub = createLobeHub({ apiKey: 'k', fetch });

    const pending = lobehub.agents.list({ signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(attempts).toBe(1);
    controller.abort();
    const { error } = await pending;

    expect((error as unknown as Error).name).toBe('AbortError');
    expect(attempts).toBe(1);

    // Aborted before it was sent: never reaches fetch at all.
    const { error: early } = await lobehub.agents.list({ signal: AbortSignal.abort() });
    expect((early as unknown as Error).name).toBe('AbortError');
    expect(attempts).toBe(1);
  });
});

describe('helpers', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', Date.UTC(2026, 0, 1))).toBe(5000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('caps the backoff at 8s with ±25% jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(500);
    expect(backoffDelay(10, () => 0.5)).toBe(8000);
    expect(backoffDelay(0, () => 0)).toBe(375);
    expect(backoffDelay(0, () => 1)).toBe(625);
  });
});
