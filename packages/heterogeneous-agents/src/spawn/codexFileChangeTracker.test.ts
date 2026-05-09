import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodexFileChangeTracker } from './codexFileChangeTracker';

describe('CodexFileChangeTracker', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
    tempDirs.length = 0;
  });

  it('enriches completed file_change payloads with per-file and total line stats', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-file-change-tracker-'));
    tempDirs.push(dir);

    const updatePath = path.join(dir, 'a.txt');
    const addPath = path.join(dir, 'b.txt');

    await writeFile(updatePath, 'hello\n', 'utf8');

    const tracker = new CodexFileChangeTracker();

    await tracker.track({
      item: {
        changes: [
          { kind: 'update', path: updatePath },
          { kind: 'add', path: addPath },
        ],
        id: 'item_1',
        type: 'file_change',
      },
      type: 'item.started',
    });

    await writeFile(updatePath, 'hello\nappended line\n', 'utf8');
    await writeFile(addPath, 'line one\nline two\n', 'utf8');

    const enriched = await tracker.track({
      item: {
        changes: [
          { kind: 'update', path: updatePath },
          { kind: 'add', path: addPath },
        ],
        id: 'item_1',
        type: 'file_change',
      },
      type: 'item.completed',
    });

    expect(enriched.item).toMatchObject({
      changes: [
        {
          kind: 'update',
          linesAdded: 1,
          linesDeleted: 0,
          path: updatePath,
        },
        {
          kind: 'add',
          linesAdded: 2,
          linesDeleted: 0,
          path: addPath,
        },
      ],
      linesAdded: 3,
      linesDeleted: 0,
    });
  });

  it('treats rename changes as metadata-only and keeps line stats at zero', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-file-change-tracker-'));
    tempDirs.push(dir);

    const beforePath = path.join(dir, 'before.txt');
    const afterPath = path.join(dir, 'after.txt');

    await writeFile(beforePath, 'content\n', 'utf8');

    const tracker = new CodexFileChangeTracker();

    await tracker.track({
      item: {
        changes: [{ kind: 'rename', path: afterPath }],
        id: 'item_rename',
        type: 'file_change',
      },
      type: 'item.started',
    });

    await rename(beforePath, afterPath);

    const enriched = await tracker.track({
      item: {
        changes: [{ kind: 'rename', path: afterPath }],
        id: 'item_rename',
        type: 'file_change',
      },
      type: 'item.completed',
    });

    expect(enriched.item).toMatchObject({
      changes: [{ kind: 'rename', linesAdded: 0, linesDeleted: 0, path: afterPath }],
      linesAdded: 0,
      linesDeleted: 0,
    });
  });

  it('counts added lines even when file content begins with repeated plus markers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-file-change-tracker-'));
    tempDirs.push(dir);

    const addPath = path.join(dir, 'plus-prefixed.txt');
    const tracker = new CodexFileChangeTracker();

    await tracker.track({
      item: {
        changes: [{ kind: 'add', path: addPath }],
        id: 'item_plus_prefix',
        type: 'file_change',
      },
      type: 'item.started',
    });

    await writeFile(addPath, '++leading content\n+++header lookalike\n', 'utf8');

    const enriched = await tracker.track({
      item: {
        changes: [{ kind: 'add', path: addPath }],
        id: 'item_plus_prefix',
        type: 'file_change',
      },
      type: 'item.completed',
    });

    expect(enriched.item).toMatchObject({
      changes: [{ kind: 'add', linesAdded: 2, linesDeleted: 0, path: addPath }],
      linesAdded: 2,
      linesDeleted: 0,
    });
  });
});
