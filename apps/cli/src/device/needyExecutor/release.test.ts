import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NeedyRelease, resolveNeedyTarget } from './release';

const ARCHIVE = Buffer.from('fake needy archive');
const DIGEST = createHash('sha256').update(ARCHIVE).digest('hex');

const fakeFetch = (digest = DIGEST) =>
  vi.fn(async (url: string | URL | Request) => {
    const body = String(url).endsWith('.sha256')
      ? Buffer.from(`${digest}  needy-aarch64-apple-darwin.tar.gz\n`)
      : ARCHIVE;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

/** Stands in for `tar`: writes the member the release asked for. */
const fakeExtract = vi.fn(async (_archive: string, member: string, destination: string) => {
  await fs.writeFile(path.join(destination, member), '#!/bin/sh\n');
});

describe('resolveNeedyTarget', () => {
  it('should map hosts needy ships an executor runner for', () => {
    expect(resolveNeedyTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(resolveNeedyTarget('darwin', 'x64')).toBe('x86_64-apple-darwin');
    expect(resolveNeedyTarget('linux', 'x64')).toBe('x86_64-unknown-linux-musl');
    expect(resolveNeedyTarget('linux', 'arm64')).toBe('aarch64-unknown-linux-musl');
  });

  it('should have no target where needy cannot read a credential file', () => {
    expect(resolveNeedyTarget('win32', 'x64')).toBeUndefined();
  });
});

describe('NeedyRelease', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'needy-release-'));
    fakeExtract.mockClear();
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { force: true, recursive: true });
  });

  it('should download the pinned release, check its digest and install the binary', async () => {
    const fetchImpl = fakeFetch();
    const release = new NeedyRelease({
      cacheDir,
      extract: fakeExtract,
      fetch: fetchImpl,
      target: 'aarch64-apple-darwin',
    });

    const binary = await release.binary('0.0.22');

    expect(binary).toBe(path.join(cacheDir, '0.0.22', 'needy'));
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      'https://github.com/needy-dev/needy/releases/download/v0.0.22/needy-aarch64-apple-darwin.tar.gz',
      'https://github.com/needy-dev/needy/releases/download/v0.0.22/needy-aarch64-apple-darwin.tar.gz.sha256',
    ]);
    expect((await fs.stat(binary)).mode & 0o777).toBe(0o700);
    // The staging directory is gone; only the binary is left.
    expect(await fs.readdir(path.join(cacheDir, '0.0.22'))).toEqual(['needy']);
  });

  it('should reuse an installed binary without downloading again', async () => {
    const fetchImpl = fakeFetch();
    const options = { cacheDir, extract: fakeExtract, fetch: fetchImpl, target: 'x' };
    await new NeedyRelease(options).binary('0.0.22');
    fetchImpl.mockClear();

    await new NeedyRelease(options).binary('0.0.22');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should share one download between concurrent callers', async () => {
    const fetchImpl = fakeFetch();
    const release = new NeedyRelease({
      cacheDir,
      extract: fakeExtract,
      fetch: fetchImpl,
      target: 'x',
    });

    await Promise.all([release.binary('0.0.22'), release.binary('0.0.22')]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fakeExtract).toHaveBeenCalledTimes(1);
  });

  it('should refuse an archive that does not match its published digest', async () => {
    const release = new NeedyRelease({
      cacheDir,
      extract: fakeExtract,
      fetch: fakeFetch('0'.repeat(64)),
      target: 'x',
    });

    await expect(release.binary('0.0.22')).rejects.toThrow('does not match its published SHA-256');
    expect(fakeExtract).not.toHaveBeenCalled();
    await expect(fs.access(path.join(cacheDir, '0.0.22', 'needy'))).rejects.toThrow();
  });

  it('should refuse a version that is not MAJOR.MINOR.PATCH before touching the network', async () => {
    const fetchImpl = fakeFetch();
    const release = new NeedyRelease({
      cacheDir,
      extract: fakeExtract,
      fetch: fetchImpl,
      target: 'x',
    });

    await expect(release.binary('../../etc')).rejects.toThrow('invalid needy version');
    await expect(release.binary('0.0.22-rc.1')).rejects.toThrow('invalid needy version');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should report a missing release at once, without retrying', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 }));
    const sleep = vi.fn(async () => {});
    const release = new NeedyRelease({
      cacheDir,
      extract: fakeExtract,
      fetch: fetchImpl as unknown as typeof fetch,
      sleep,
      target: 'x',
    });

    await expect(release.binary('9.9.9')).rejects.toThrow('HTTP 404');
    expect(sleep).not.toHaveBeenCalled();
  });

  // ROOT CAUSE:
  //
  // If GitHub's release asset host reset the connection mid-download, the first
  // attach on a device failed with `ECONNRESET` because the download ran once.
  //
  // Before the fix, one dropped connection failed the attach.
  // The fix retries network errors and 5xx twice, with a pause between tries.
  it('should retry a dropped connection and a server error before giving up', async () => {
    const real = fakeFetch();
    let archiveCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).endsWith('.sha256')) {
        archiveCalls++;
        if (archiveCalls === 1)
          throw new TypeError('The socket connection was closed unexpectedly');
        if (archiveCalls === 2) return new Response('busy', { status: 503 });
      }
      return real(url);
    });
    const sleep = vi.fn(async () => {});
    const release = new NeedyRelease({
      cacheDir,
      extract: fakeExtract,
      fetch: fetchImpl as unknown as typeof fetch,
      sleep,
      target: 'x',
    });

    await expect(release.binary('0.0.22')).resolves.toBe(path.join(cacheDir, '0.0.22', 'needy'));
    expect(archiveCalls).toBe(3);
    expect(sleep.mock.calls).toEqual([[1000], [3000]]);
  });
});
