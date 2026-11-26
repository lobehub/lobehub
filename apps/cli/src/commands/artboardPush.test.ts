import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushArtboardDir } from './artboardPush';

const md5 = (bytes: string | Buffer) => createHash('md5').update(bytes).digest('hex');

let dir: string;

const put = (relative: string, content: string | Buffer) => {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const client = (
  remote: { contentType: string; hash: string; path: string; size: number }[],
  options: { uploads?: { headers?: Record<string, string>; path: string; url: string }[] } = {},
) => {
  const writeFiles = vi.fn(async ({ files }: { files: { writes?: { path: string }[] } }) => ({
    files: (files.writes ?? []).map((write) => ({ hash: 'h', path: write.path, size: 1 })),
  }));
  const prepareFileUploads = vi.fn(async () => ({ uploads: options.uploads ?? [] }));
  return {
    api: {
      listFiles: { query: vi.fn(async () => remote) },
      prepareFileUploads: { mutate: prepareFileUploads },
      writeFiles: { mutate: writeFiles },
    },
    prepareFileUploads,
    writeFiles,
  };
};

const fetchMock = vi.fn();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artboard-push-'));
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
  vi.unstubAllGlobals();
});

describe('pushArtboardDir', () => {
  it('uploads new and changed files, text as content and images as base64', async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    put('pages/home.html', '<h1>Home</h1>');
    put('pages/same.html', '<p>same</p>');
    put('shots/a.png', png);
    const { api, writeFiles } = client([
      { contentType: 'text/html', hash: md5('<p>same</p>'), path: 'pages/same.html', size: 11 },
      // A sha256 of the same bytes is not the ETag the server reports.
      {
        contentType: 'image/png',
        hash: createHash('sha256').update(png).digest('hex'),
        path: 'shots/a.png',
        size: 4,
      },
    ]);

    const result = await pushArtboardDir(api, 'art_1', dir, {});

    expect(writeFiles).toHaveBeenCalledTimes(1);
    expect(writeFiles.mock.calls[0][0]).toEqual({
      files: {
        writes: [
          { content: '<h1>Home</h1>', path: 'pages/home.html' },
          { base64: png.toString('base64'), path: 'shots/a.png' },
        ],
      },
      id: 'art_1',
    });
    expect(result).toEqual({
      deleted: [],
      skipped: [],
      unchanged: ['pages/same.html'],
      uploaded: ['pages/home.html', 'shots/a.png'],
    });
  });

  it('skips files a board cannot serve and hidden files', async () => {
    put('notes.md', '# notes');
    put('.DS_Store', 'x');
    put('index.html', '<p>hi</p>');
    const { api } = client([]);

    const result = await pushArtboardDir(api, 'art_1', dir, {});

    expect(result.uploaded).toEqual(['index.html']);
    expect(result.skipped).toEqual(['notes.md']);
  });

  it('deletes remote files missing locally only with prune', async () => {
    put('index.html', '<p>hi</p>');
    const remote = [
      { contentType: 'text/html', hash: md5('<p>hi</p>'), path: 'index.html', size: 9 },
      { contentType: 'text/html', hash: 'x', path: 'old.html', size: 1 },
    ];
    const kept = client(remote);
    expect((await pushArtboardDir(kept.api, 'art_1', dir, {})).deleted).toEqual([]);
    expect(kept.writeFiles).not.toHaveBeenCalled();

    const pruned = client(remote);
    const result = await pushArtboardDir(pruned.api, 'art_1', dir, { prune: true });
    expect(pruned.writeFiles.mock.calls[0][0]).toEqual({
      files: { deletes: ['old.html'] },
      id: 'art_1',
    });
    expect(result.deleted).toEqual(['old.html']);
  });

  it('prunes every remote file missing locally, even one a board points at', async () => {
    put('index.html', '<p>hi</p>');
    const remote = [
      { contentType: 'text/html', hash: md5('<p>hi</p>'), path: 'index.html', size: 9 },
      { contentType: 'text/html', hash: 'x', path: 'old.html', size: 1 },
      { contentType: 'text/html', hash: 'y', path: 'pages/shown.html', size: 1 },
    ];
    const { api, writeFiles } = client(remote);

    const result = await pushArtboardDir(api, 'art_1', dir, { prune: true });

    expect(writeFiles).toHaveBeenCalledTimes(1);
    expect(writeFiles.mock.calls[0][0]).toEqual({
      files: { deletes: ['old.html', 'pages/shown.html'] },
      id: 'art_1',
    });
    expect(result).toEqual({
      deleted: ['old.html', 'pages/shown.html'],
      skipped: [],
      unchanged: ['index.html'],
      uploaded: [],
    });
  });

  it('keeps every request under 2 MB encoded and sends a large image through a presigned PUT', async () => {
    const image = Buffer.alloc(6 * 1024 * 1024, 7);
    put('shots/big.png', image);
    // Quotes double when JSON-escaped: 700 KB on disk, 1.4 MB in the request.
    put('pages/a.html', '"'.repeat(700 * 1024));
    put('pages/b.html', '"'.repeat(700 * 1024));
    put('pages/c.html', '<p>c</p>');
    put('shots/small.png', Buffer.alloc(600 * 1024, 1));
    const headers = { 'Content-Type': 'image/png' };
    const { api, prepareFileUploads, writeFiles } = client([], {
      uploads: [{ headers, path: 'shots/big.png', url: 'https://s3.test/blob' }],
    });

    const result = await pushArtboardDir(api, 'art_1', dir, {});

    for (const [input] of writeFiles.mock.calls)
      expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(prepareFileUploads).toHaveBeenCalledWith({
      files: [{ path: 'shots/big.png', size: image.byteLength }],
      id: 'art_1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://s3.test/blob');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual(headers);
    expect(Buffer.from(init.body).equals(image)).toBe(true);
    const writes = writeFiles.mock.calls.flatMap(([input]) => input.files.writes ?? []);
    expect(writes).toContainEqual({ path: 'shots/big.png', uploaded: true });
    expect(writes.map((write) => write.path).sort()).toEqual([
      'pages/a.html',
      'pages/b.html',
      'pages/c.html',
      'shots/big.png',
      'shots/small.png',
    ]);
    expect(result.uploaded).toHaveLength(5);
  });

  it('fails without committing a large file the server returned no upload for', async () => {
    put('shots/big.png', Buffer.alloc(3 * 1024 * 1024, 9));
    const { api, writeFiles } = client([], { uploads: [] });

    await expect(pushArtboardDir(api, 'art_1', dir, {})).rejects.toThrow(/shots\/big\.png/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(writeFiles).not.toHaveBeenCalled();
  });

  it('names the file whose presigned upload was refused and commits nothing for it', async () => {
    put('shots/big.png', Buffer.alloc(3 * 1024 * 1024, 3));
    fetchMock.mockResolvedValue(new Response('denied', { status: 403, statusText: 'Forbidden' }));
    const { api, writeFiles } = client([], {
      uploads: [{ path: 'shots/big.png', url: 'https://s3.test/blob' }],
    });

    await expect(pushArtboardDir(api, 'art_1', dir, {})).rejects.toThrow(/shots\/big\.png.*403/);
    expect(writeFiles).not.toHaveBeenCalled();
  });
});
