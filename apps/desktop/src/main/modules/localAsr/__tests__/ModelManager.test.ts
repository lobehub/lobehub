import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { LocalAsrModelProgressPayload } from '@lobechat/electron-client-ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalAsrModelPack } from '../catalog';
import { LocalAsrModelManager } from '../ModelManager';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const MODEL = Buffer.from('fake-onnx-model-'.repeat(4096));
const TOKENS = Buffer.from('tokens');

const PACKS: LocalAsrModelPack[] = [
  {
    description: 'test pack',
    files: [
      {
        name: 'model.onnx',
        sha256: sha256(MODEL),
        size: MODEL.length,
        urls: ['https://primary.test/model.onnx', 'https://mirror.test/model.onnx'],
      },
      {
        name: 'tokens.txt',
        sha256: sha256(TOKENS),
        size: TOKENS.length,
        urls: ['https://primary.test/tokens.txt'],
      },
    ],
    id: 'asr-sensevoice',
    required: true,
  },
];

const BODIES: Record<string, Buffer> = {
  'model.onnx': MODEL,
  'tokens.txt': TOKENS,
};

const respond = (body: Buffer, status = 200) =>
  new Response(new Uint8Array(body), {
    headers: { 'content-length': String(body.length) },
    status,
  });

describe('LocalAsrModelManager', () => {
  let dir: string;
  let events: LocalAsrModelProgressPayload[];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'local-asr-models-'));
    events = [];
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  const create = (fetcher: typeof fetch) =>
    new LocalAsrModelManager({
      dir,
      fetcher,
      onProgress: (event) => events.push(event),
      packs: PACKS,
    });

  const serveAll: typeof fetch = async (input) => {
    const name = String(input).split('/').pop()!;
    return respond(BODIES[name]);
  };

  it('downloads every file, verifies the hash and reports ready', async () => {
    const manager = create(vi.fn(serveAll));

    expect((await manager.getPackStates())[0].status).toBe('not_downloaded');
    const state = await manager.download('asr-sensevoice');

    expect(state.status).toBe('ready');
    expect(state.downloadedBytes).toBe(MODEL.length + TOKENS.length);
    expect(await readFile(path.join(dir, 'model.onnx'))).toEqual(MODEL);
    expect(events.at(-1)).toMatchObject({ id: 'asr-sensevoice', status: 'ready' });
    expect(await manager.getReadyPaths('asr-sensevoice')).toEqual({
      'model.onnx': path.join(dir, 'model.onnx'),
      'tokens.txt': path.join(dir, 'tokens.txt'),
    });
  });

  it('falls back to the mirror when the primary URL fails', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://primary.test/model'))
        return respond(Buffer.from(''), 503);
      return serveAll(input);
    }) as unknown as typeof fetch;
    const manager = create(fetcher);

    const state = await manager.download('asr-sensevoice');

    expect(state.status).toBe('ready');
    expect(fetcher).toHaveBeenCalledWith('https://mirror.test/model.onnx', expect.anything());
  });

  it('rejects a download whose checksum does not match', async () => {
    const manager = create(async (input) => {
      const name = String(input).split('/').pop()!;
      return respond(name === 'model.onnx' ? Buffer.from('x'.repeat(MODEL.length)) : BODIES[name]);
    });

    const state = await manager.download('asr-sensevoice');

    expect(state.status).toBe('corrupted');
    expect(state.error).toBe('checksum_mismatch:model.onnx');
    await expect(stat(path.join(dir, 'model.onnx'))).rejects.toThrow();
    await expect(stat(path.join(dir, 'model.onnx.part'))).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ status: 'corrupted' });
  });

  it('resumes a partial download with a Range request', async () => {
    const half = MODEL.length / 2;
    await writeFile(path.join(dir, 'model.onnx.part'), MODEL.subarray(0, half));
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const name = String(input).split('/').pop()!;
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (name === 'model.onnx' && range === `bytes=${half}-`)
        return respond(MODEL.subarray(half), 206);
      return respond(BODIES[name]);
    }) as unknown as typeof fetch;
    const manager = create(fetcher);

    expect((await manager.getPackStates())[0].downloadedBytes).toBe(half);
    const state = await manager.download('asr-sensevoice');

    expect(state.status).toBe('ready');
    expect(await readFile(path.join(dir, 'model.onnx'))).toEqual(MODEL);
  });

  it('flags a tampered file on verify and removes files on delete', async () => {
    const manager = create(serveAll);
    await manager.download('asr-sensevoice');

    expect((await manager.verify('asr-sensevoice')).status).toBe('ready');

    const tampered = Buffer.from(MODEL);
    tampered[0] = 0;
    await writeFile(path.join(dir, 'model.onnx'), tampered);
    expect((await manager.verify('asr-sensevoice')).status).toBe('corrupted');

    const deleted = await manager.delete('asr-sensevoice');
    expect(deleted.status).toBe('not_downloaded');
    expect(deleted.downloadedBytes).toBe(0);
    await expect(stat(path.join(dir, 'model.onnx'))).rejects.toThrow();
  });

  it('treats a malformed verified manifest as empty', async () => {
    await writeFile(path.join(dir, 'verified.json'), 'null');
    const manager = create(serveAll);

    expect((await manager.getPackStates())[0].status).toBe('not_downloaded');
    expect((await manager.download('asr-sensevoice')).status).toBe('ready');
  });

  it('keeps only own string entries from the verified manifest', async () => {
    await writeFile(
      path.join(dir, 'verified.json'),
      JSON.stringify({ '__proto__': { polluted: 'yes' }, 'model.onnx': 42 }),
    );
    const manager = create(serveAll);
    await manager.download('asr-sensevoice');

    const manifest = JSON.parse(await readFile(path.join(dir, 'verified.json'), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['model.onnx', 'tokens.txt']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('stops on cancel and keeps the partial file for resuming', async () => {
    const ref: { manager?: LocalAsrModelManager } = {};
    const fetcher: typeof fetch = async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(MODEL.subarray(0, 1024)));
          ref.manager!.cancel('asr-sensevoice');
        },
      });
      init?.signal?.addEventListener('abort', () => undefined);
      return new Response(stream, { status: 200 });
    };
    const manager = create(fetcher);
    ref.manager = manager;

    const state = await manager.download('asr-sensevoice');

    expect(state.status).toBe('not_downloaded');
    expect(events.at(-1)).toMatchObject({ status: 'not_downloaded' });
    expect(manager.isDownloading('asr-sensevoice')).toBe(false);
  });
});
