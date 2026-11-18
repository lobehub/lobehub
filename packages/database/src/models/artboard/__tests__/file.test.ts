// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { artboards, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ArtboardFileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-file-user';
const otherUserId = 'artboard-file-other';
const artboardId = 'art_file_1';

const files = new ArtboardFileModel(serverDB, userId);

const file = (path: string, hash: string, size = 10) => ({
  contentType: 'text/html; charset=utf-8',
  hash,
  path,
  size,
});

const cleanup = () => serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(artboards).values({ id: artboardId, title: 'Board', userId });
});

afterEach(cleanup);

describe('ArtboardFileModel', () => {
  it('lists the files written to an artboard by path', async () => {
    await files.upsert(artboardId, [file('pages/b.html', 'h-b'), file('pages/a.html', 'h-a')]);

    const rows = await files.list(artboardId);

    expect(rows.map((row) => [row.path, row.hash])).toEqual([
      ['pages/a.html', 'h-a'],
      ['pages/b.html', 'h-b'],
    ]);
  });

  it('replaces the content of a path written again', async () => {
    await files.upsert(artboardId, [file('pages/a.html', 'h-1', 10)]);
    await files.upsert(artboardId, [file('pages/a.html', 'h-2', 20)]);

    const rows = await files.list(artboardId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hash: 'h-2', path: 'pages/a.html', size: 20 });
  });

  it('removes deleted paths only', async () => {
    await files.upsert(artboardId, [file('a.css', 'h-a'), file('b.css', 'h-b')]);

    await files.delete(artboardId, ['a.css']);

    expect((await files.list(artboardId)).map((row) => row.path)).toEqual(['b.css']);
  });

  it("hides another user's artboard files and refuses writes to them", async () => {
    await files.upsert(artboardId, [file('a.html', 'h-a')]);
    const stranger = new ArtboardFileModel(serverDB, otherUserId);

    expect(await stranger.list(artboardId)).toEqual([]);
    await expect(stranger.upsert(artboardId, [file('x.html', 'h-x')])).rejects.toThrow();
    await stranger.delete(artboardId, ['a.html']);
    expect(await files.list(artboardId)).toHaveLength(1);
  });

  it('drops the files with their artboard', async () => {
    await files.upsert(artboardId, [file('a.html', 'h-a')]);

    await serverDB.delete(artboards).where(eq(artboards.id, artboardId));

    expect(await files.list(artboardId)).toEqual([]);
  });
});
