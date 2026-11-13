/**
 * Music generation smoke test for `ModelRuntime.createMusic`.
 *
 * Real providers (costs credits):
 *   MINIMAX_API_KEY=... [MINIMAX_BASE_URL=https://api.minimaxi.com/v1] \
 *   SUNO_API_KEY=...    SUNO_CALLBACK_URL=https://... [SUNO_BASE_URL=https://api.sunoapi.org] \
 *     bun packages/model-runtime/scripts/music-smoke.ts
 *
 * Without keys, the script serves a local mock of both APIs and runs the same code path
 * (ModelRuntime → provider runtime → HTTP → task polling) against it.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ModelRuntime } from '../src/core/ModelRuntime';

const startMockServer = async () => {
  let sunoPolls = 0;
  const server = createServer((req, res) => {
    const send = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const authorized = req.headers.authorization === 'Bearer mock-key';

    if (req.url?.startsWith('/minimax/v1/music_generation')) {
      if (!authorized) return send({ base_resp: { status_code: 1004, status_msg: 'auth failed' } });
      return send({
        base_resp: { status_code: 0, status_msg: 'success' },
        data: { audio: 'https://mock.local/minimax/song.mp3', status: 2 },
        extra_info: { music_duration: 30_000 },
        trace_id: 'mock-trace',
      });
    }
    if (req.url?.startsWith('/suno/api/v1/generate/record-info')) {
      sunoPolls += 1;
      if (sunoPolls < 3) return send({ code: 200, data: { status: 'PENDING' }, msg: 'success' });
      return send({
        code: 200,
        data: {
          response: {
            sunoData: [{ audioUrl: 'https://mock.local/suno/a.mp3', duration: 120, id: 'clip' }],
          },
          status: 'SUCCESS',
        },
        msg: 'success',
      });
    }
    if (req.url?.startsWith('/suno/api/v1/generate')) {
      if (!authorized) return send({ code: 401, data: null, msg: 'Unauthorized' }, 401);
      return send({ code: 200, data: { taskId: 'mock-task' }, msg: 'success' });
    }
    send({ msg: 'not found' }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
};

const run = async (label: string, fn: () => Promise<unknown>) => {
  try {
    console.log(`\n[${label}] OK`, JSON.stringify(await fn(), null, 2));
  } catch (error) {
    console.log(`\n[${label}] ERROR`, JSON.stringify(error, null, 2));
  }
};

const main = async () => {
  const mock =
    process.env.MINIMAX_API_KEY && process.env.SUNO_API_KEY ? undefined : await startMockServer();
  if (mock) console.log(`No MINIMAX_API_KEY / SUNO_API_KEY: using mock APIs at ${mock.origin}`);

  const minimax = ModelRuntime.initializeWithProvider('minimax', {
    apiKey: process.env.MINIMAX_API_KEY ?? 'mock-key',
    baseURL: mock ? `${mock.origin}/minimax/v1` : process.env.MINIMAX_BASE_URL,
  });
  const suno = ModelRuntime.initializeWithProvider('suno', {
    apiKey: process.env.SUNO_API_KEY ?? 'mock-key',
    baseURL: mock ? `${mock.origin}/suno` : process.env.SUNO_BASE_URL,
  });

  await run('minimax music-2.6', () =>
    minimax.createMusic({
      model: 'music-2.6',
      params: {
        lyrics: '[Verse]\nNeon lights on the empty road\n[Chorus]\nDrive all night',
        prompt: 'City pop, night drive, female vocals',
      },
    }),
  );

  await run('suno-v5 (submit + poll)', () =>
    suno.createMusic(
      {
        model: 'suno-v5',
        params: {
          lyrics: '[Verse]\nNeon lights on the empty road\n[Chorus]\nDrive all night',
          style: 'city pop, female vocals',
          title: 'Night Drive',
        },
      },
      {
        // Suno requires a webhook even when polling; any reachable URL works for the smoke test.
        callbackUrl: process.env.SUNO_CALLBACK_URL ?? 'https://example.com/suno-callback',
        pollIntervalMs: mock ? 100 : 10_000,
        timeoutMs: 10 * 60 * 1000,
        waitForCompletion: true,
      },
    ),
  );

  if (mock) {
    const badKey = ModelRuntime.initializeWithProvider('suno', {
      apiKey: 'wrong-key',
      baseURL: `${mock.origin}/suno`,
    });
    await run('suno invalid key', () =>
      badKey.createMusic(
        { model: 'suno-v5', params: { prompt: 'a happy song', style: 'pop' } },
        { callbackUrl: 'https://example.com/suno-callback' },
      ),
    );
    mock.server.close();
  }
};

await main();
