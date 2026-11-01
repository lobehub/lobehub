import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionSnapshot } from '../types';
import { AmbiguousSnapshotIdError, loadSnapshot, MissingTracingBaseUrlError } from './loadSnapshot';

const OP_ID = 'op_1_agt_aaa_tpc_bbb_ccc';

const snapshot = (traceId: string): ExecutionSnapshot =>
  ({
    completedAt: 2,
    operationId: OP_ID,
    startedAt: 1,
    steps: [],
    totalCost: 0,
    totalSteps: 0,
    totalTokens: 0,
    traceId,
  }) as ExecutionSnapshot;

const makeRoot = async () => mkdtemp(path.join(tmpdir(), 'load-snapshot-'));

const writeRemoteCache = async (root: string, operationId: string, traceId = 'trace-remote') => {
  const dir = path.join(root, '.agent-tracing', '_remote');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${operationId}.json`), JSON.stringify(snapshot(traceId)), 'utf8');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadSnapshot', () => {
  it('reads a snapshot json path directly', async () => {
    const root = await makeRoot();
    const file = path.join(root, 'snap.json');
    await writeFile(file, JSON.stringify(snapshot('trace-file')), 'utf8');

    expect((await loadSnapshot(file))?.traceId).toBe('trace-file');
  });

  it('serves an operation id from the _remote cache without network', async () => {
    const root = await makeRoot();
    await writeRemoteCache(root, OP_ID);

    expect((await loadSnapshot(OP_ID, { rootDir: root }))?.traceId).toBe('trace-remote');
  });

  it('resolves an op id prefix against the cache', async () => {
    const root = await makeRoot();
    await writeRemoteCache(root, OP_ID);

    expect((await loadSnapshot('op_1', { rootDir: root }))?.traceId).toBe('trace-remote');
  });

  it('refuses to guess between multiple prefix matches', async () => {
    const root = await makeRoot();
    await writeRemoteCache(root, 'op_1_agt_aaa_tpc_bbb_one');
    await writeRemoteCache(root, 'op_1_agt_aaa_tpc_bbb_two');

    await expect(loadSnapshot('op_1', { rootDir: root })).rejects.toThrow(AmbiguousSnapshotIdError);
  });

  it('does not download unless explicitly allowed', async () => {
    const root = await makeRoot();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await loadSnapshot(OP_ID, { rootDir: root })).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('explains how to configure the base URL when a download is requested without one', async () => {
    const root = await makeRoot();
    vi.stubEnv('TRACING_BASE_URL', '');

    await expect(loadSnapshot(OP_ID, { allowDownload: true, rootDir: root })).rejects.toThrow(
      MissingTracingBaseUrlError,
    );
  });

  it('returns undefined for an unknown target rather than throwing', async () => {
    const root = await makeRoot();
    expect(await loadSnapshot('nope', { rootDir: root })).toBeUndefined();
  });

  describe('resolveDownloadUrl', () => {
    it('downloads from the resolved URL instead of TRACING_BASE_URL', async () => {
      const root = await makeRoot();
      vi.stubEnv('TRACING_BASE_URL', 'https://public.example.com/agent-traces');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(Buffer.from(JSON.stringify(snapshot('trace-signed'))), { status: 200 }),
        );

      const result = await loadSnapshot(OP_ID, {
        allowDownload: true,
        resolveDownloadUrl: async () => 'https://signed.example.com/obj?sig=abc',
        rootDir: root,
      });

      expect(result?.traceId).toBe('trace-signed');
      expect(fetchSpy).toHaveBeenCalledWith('https://signed.example.com/obj?sig=abc');

      fetchSpy.mockRestore();
    });

    it('is not consulted when the snapshot is already cached locally', async () => {
      const root = await makeRoot();
      await writeRemoteCache(root, OP_ID);
      const resolveDownloadUrl = vi.fn();

      expect(
        (await loadSnapshot(OP_ID, { allowDownload: true, resolveDownloadUrl, rootDir: root }))
          ?.traceId,
      ).toBe('trace-remote');
      expect(resolveDownloadUrl).not.toHaveBeenCalled();
    });

    it('falls back to TRACING_BASE_URL when the resolver has nothing to offer', async () => {
      const root = await makeRoot();
      vi.stubEnv('TRACING_BASE_URL', 'https://public.example.com/agent-traces');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(Buffer.from(JSON.stringify(snapshot('trace-public'))), { status: 200 }),
        );

      const result = await loadSnapshot(OP_ID, {
        allowDownload: true,
        resolveDownloadUrl: async () => null,
        rootDir: root,
      });

      expect(result?.traceId).toBe('trace-public');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://public.example.com/agent-traces/agt_aaa/tpc_bbb/op_1_agt_aaa_tpc_bbb_ccc.json.zst',
      );

      fetchSpy.mockRestore();
    });
  });
});
