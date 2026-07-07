import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prepareSkillDirectory } from '../skillDirectory';

let cacheRoot: string;

const buildZip = (entries: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, content]) => [name, new TextEncoder().encode(content)]),
    ),
  );

const okResponse = (zip: Uint8Array) =>
  ({
    arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
    ok: true,
  }) as Response;

beforeEach(async () => {
  cacheRoot = await mkdtemp(path.join(tmpdir(), 'skill-dir-'));
});

afterEach(async () => {
  await rm(cacheRoot, { force: true, recursive: true });
});

describe('prepareSkillDirectory', () => {
  it('downloads, extracts and marks the directory prepared', async () => {
    const zip = buildZip({ 'SKILL.md': '# skill', 'scripts/run.sh': 'echo hi' });
    const fetchSkillArchive = vi.fn(async () => okResponse(zip));

    const result = await prepareSkillDirectory(
      { url: 'https://example.com/skill.zip', zipHash: 'hash-1' },
      { fetchSkillArchive, skillCacheRoot: cacheRoot },
    );

    expect(result.success).toBe(true);
    expect(result.extractedDir).toBe(path.join(cacheRoot, 'extracted', 'hash-1'));
    await expect(readFile(path.join(result.extractedDir, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# skill',
    );
    await expect(
      readFile(path.join(result.extractedDir, 'scripts', 'run.sh'), 'utf8'),
    ).resolves.toBe('echo hi');
    const marker = JSON.parse(await readFile(path.join(result.extractedDir, '.prepared'), 'utf8'));
    expect(marker.zipHash).toBe('hash-1');
  });

  it('is idempotent on zipHash: second call skips the download', async () => {
    const zip = buildZip({ 'SKILL.md': '# skill' });
    const fetchSkillArchive = vi.fn(async () => okResponse(zip));
    const deps = { fetchSkillArchive, skillCacheRoot: cacheRoot };

    await prepareSkillDirectory({ url: 'https://example.com/a.zip', zipHash: 'hash-1' }, deps);
    const second = await prepareSkillDirectory(
      { url: 'https://example.com/a.zip', zipHash: 'hash-1' },
      deps,
    );

    expect(second.success).toBe(true);
    expect(fetchSkillArchive).toHaveBeenCalledTimes(1);
  });

  it('re-downloads when forceRefresh is set', async () => {
    const zip = buildZip({ 'SKILL.md': '# skill' });
    const fetchSkillArchive = vi.fn(async () => okResponse(zip));
    const deps = { fetchSkillArchive, skillCacheRoot: cacheRoot };

    await prepareSkillDirectory({ url: 'https://example.com/a.zip', zipHash: 'hash-1' }, deps);
    await prepareSkillDirectory(
      { forceRefresh: true, url: 'https://example.com/a.zip', zipHash: 'hash-1' },
      deps,
    );

    expect(fetchSkillArchive).toHaveBeenCalledTimes(2);
  });

  // Two concurrent cache-missed prepares of the same zipHash used to both
  // pass the marker check and interleave rm/extract on the live directory.
  it('serializes concurrent prepares of the same zipHash so the follower reuses the cache', async () => {
    const zip = buildZip({ 'SKILL.md': '# skill' });
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchSkillArchive = vi.fn(async () => {
      await gate;
      return okResponse(zip);
    });
    const deps = { fetchSkillArchive, skillCacheRoot: cacheRoot };

    const first = prepareSkillDirectory(
      { url: 'https://example.com/a.zip', zipHash: 'hash-1' },
      deps,
    );
    const second = prepareSkillDirectory(
      { url: 'https://example.com/a.zip', zipHash: 'hash-1' },
      deps,
    );
    releaseFetch();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(fetchSkillArchive).toHaveBeenCalledTimes(1);
    // The staging dir is swapped in via rename, never left behind.
    await expect(readdir(path.join(cacheRoot, 'extracted'))).resolves.toEqual(['hash-1']);
  });

  it('rejects zipHash values that are not plain content-hash tokens', async () => {
    const fetchSkillArchive = vi.fn();

    const result = await prepareSkillDirectory(
      { url: 'https://example.com/a.zip', zipHash: '../../../etc' },
      { fetchSkillArchive, skillCacheRoot: cacheRoot },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid zipHash');
    expect(result.extractedDir).toBe('');
    expect(fetchSkillArchive).not.toHaveBeenCalled();
  });

  it('rejects archives with path traversal entries', async () => {
    const zip = buildZip({ '../evil.txt': 'pwned' });

    const result = await prepareSkillDirectory(
      { url: 'https://example.com/evil.zip', zipHash: 'hash-evil' },
      { fetchSkillArchive: async () => okResponse(zip), skillCacheRoot: cacheRoot },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsafe file path');
  });

  it('returns a failure result when the download fails', async () => {
    const result = await prepareSkillDirectory(
      { url: 'https://example.com/missing.zip', zipHash: 'hash-404' },
      {
        fetchSkillArchive: async () =>
          ({ ok: false, status: 404, statusText: 'Not Found' }) as Response,
        skillCacheRoot: cacheRoot,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });
});
