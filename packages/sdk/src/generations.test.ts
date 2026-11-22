import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Generation } from './index';
import { createLobeHub, GenerationWaitTimeoutError, LobeHubAPIError } from './index';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

const generation = (status: Generation['status'], extra: Partial<Generation> = {}): Generation => ({
  asset: null,
  batchId: 'gb_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  error: null,
  fileId: null,
  id: 'gen_1',
  model: 'seedance-1-0-pro',
  prompt: 'waves',
  provider: 'volcengine',
  seed: null,
  status,
  topicId: 'gt_1',
  type: 'video',
  ...extra,
});

/** Answers `GET /generations/{id}` with each state in turn, repeating the last one. */
const statusFetch = (states: (Generation | Response)[]) => {
  const urls: string[] = [];
  const fetch = (async (input: Request) => {
    urls.push(new URL(input.url).pathname);
    const next = states[Math.min(urls.length - 1, states.length - 1)];
    return next instanceof Response
      ? next.clone()
      : json({ data: next, success: true, timestamp: '2026-01-01T00:00:00Z' });
  }) as typeof globalThis.fetch;
  return { fetch, urls };
};

describe('generations.wait', () => {
  it('polls until the generation succeeds and returns its final state', async () => {
    const done = generation('success', {
      asset: {
        coverUrl: 'https://cdn.test/cover.webp',
        duration: 5,
        height: 720,
        thumbnailUrl: 'https://cdn.test/thumb.webp',
        url: 'https://cdn.test/video.mp4',
        width: 1280,
      },
    });
    const { fetch, urls } = statusFetch([generation('pending'), generation('processing'), done]);
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });
    const seen: string[] = [];

    const result = await lobehub.generations.wait('gen_1', {
      onPoll: (state) => seen.push(state.status),
      pollInterval: 1,
    });

    expect(result).toEqual(done);
    expect(seen).toEqual(['pending', 'processing', 'success']);
    expect(urls).toEqual(Array.from({ length: 3 }, () => '/api/v1/generations/gen_1'));
    expectTypeOf(result).toEqualTypeOf<Generation>();
  });

  it('resolves with a failed generation instead of throwing', async () => {
    const failed = generation('error', {
      error: { message: 'Content policy', name: 'ServerError' },
    });
    const { fetch } = statusFetch([generation('processing'), failed]);
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    await expect(lobehub.generations.wait('gen_1', { pollInterval: 1 })).resolves.toEqual(failed);
  });

  it('gives up after the timeout with the last state it read', async () => {
    const { fetch } = statusFetch([generation('processing')]);
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const error = await lobehub.generations
      .wait('gen_1', { pollInterval: 5, timeout: 20 })
      .catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(GenerationWaitTimeoutError);
    expect((error as GenerationWaitTimeoutError).generation.status).toBe('processing');
  });

  it('bounds a slow status request by the wait timeout', async () => {
    const fetch = (async (input: Request) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2000);
        input.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(input.signal.reason);
        });
      });
      return json({ data: generation('success'), success: true, timestamp: 't' });
    }) as typeof globalThis.fetch;
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });

    const started = Date.now();
    const error = await lobehub.generations
      .wait('gen_1', { timeout: 50 })
      .catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(GenerationWaitTimeoutError);
    expect((error as GenerationWaitTimeoutError).generation).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rejects with the API error when the generation cannot be read', async () => {
    const { fetch, urls } = statusFetch([
      json(
        {
          code: 'not_found',
          message: 'Generation not found',
          success: false,
          timestamp: '2026-01-01T00:00:00Z',
        },
        404,
      ),
    ]);
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, maxRetries: 0 });

    const error = await lobehub.generations.wait('gen_x').catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(LobeHubAPIError);
    expect(error).toMatchObject({ code: 'not_found', status: 404 });
    expect(urls).toHaveLength(1);
  });

  it('stops when the signal aborts', async () => {
    const { fetch } = statusFetch([generation('pending')]);
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch });
    const controller = new AbortController();

    const waiting = lobehub.generations.wait('gen_1', {
      pollInterval: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('stop')), 5);

    await expect(waiting).rejects.toThrow('stop');
  });

  it('is available on a throwOnError client too', async () => {
    const { fetch } = statusFetch([generation('success')]);
    const lobehub = createLobeHub({ apiKey: 'sk-lh-test', fetch, throwOnError: true });

    await expect(lobehub.generations.wait('gen_1')).resolves.toMatchObject({ status: 'success' });
    const { data } = await lobehub.generations.get({ path: { id: 'gen_1' } });
    expectTypeOf(data.data).toEqualTypeOf<Generation>();
  });
});
