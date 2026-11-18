import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushArtboardDir } from './artboardPush';

const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

let dir: string;

const put = (relative: string, content: string | Buffer) => {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const client = (remote: { hash: string; path: string; size: number }[]) => {
  const writeFiles = vi.fn(async ({ files }: { files: { writes?: { path: string }[] } }) => ({
    files: (files.writes ?? []).map((write) => ({ hash: 'h', path: write.path, size: 1 })),
  }));
  return {
    api: { listFiles: { query: vi.fn(async () => remote) }, writeFiles: { mutate: writeFiles } },
    writeFiles,
  };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artboard-push-'));
});

afterEach(() => {
  fs.rmSync(dir, { force: true, recursive: true });
});

describe('pushArtboardDir', () => {
  it('uploads new and changed files, text as content and images as base64', async () => {
    const png = Buffer.from([137, 80, 78, 71]);
    put('pages/home.html', '<h1>Home</h1>');
    put('pages/same.html', '<p>same</p>');
    put('shots/a.png', png);
    const { api, writeFiles } = client([
      { hash: sha('<p>same</p>'), path: 'pages/same.html', size: 11 },
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
      { hash: sha('<p>hi</p>'), path: 'index.html', size: 9 },
      { hash: 'x', path: 'old.html', size: 1 },
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

  it('splits a large push into several requests', async () => {
    put('a.html', 'a'.repeat(3 * 1024 * 1024));
    put('b.html', 'b'.repeat(3 * 1024 * 1024));
    const { api, writeFiles } = client([]);

    await pushArtboardDir(api, 'art_1', dir, {});

    expect(writeFiles).toHaveBeenCalledTimes(2);
  });
});
