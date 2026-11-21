// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ArtboardFileModel } from '../artboardFile';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'artboard-file-user';
const otherUserId = 'artboard-file-other';
const workspaceId = 'artboard-file-ws';

const boardId = 'art_board_files';
const otherBoardId = 'art_board_files_other';

const personal = new ArtboardFileModel(serverDB, userId);
const inWorkspace = new ArtboardFileModel(serverDB, userId, workspaceId);

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId });
  await serverDB.insert(workspaceMembers).values([{ userId, workspaceId }]);
});

afterEach(async () => {
  await cleanup();
});

const rowsOfBoard = (id: string) =>
  serverDB.select().from(files).where(eq(files.source, FileSource.Artboard)).then((rows) =>
    rows.filter((row) => (row.metadata as { artboardId?: string } | null)?.artboardId === id),
  );

describe('ArtboardFileModel', () => {
  it('stores the files an artboard write kept and removes the ones it dropped', async () => {
    await personal.record(
      boardId,
      [
        {
          contentType: 'text/html',
          key: 's3://bucket/pages/index.html',
          path: 'pages/index.html',
          size: 1024,
        },
        { contentType: 'image/png', key: 's3://bucket/assets/hero.png', path: 'assets/hero.png', size: 2048 },
      ],
      ['pages/old.html'],
    );

    const rows = await rowsOfBoard(boardId);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.name).sort()).toEqual(['hero.png', 'index.html']);
    expect(rows.find((row) => row.name === 'index.html')).toMatchObject({
      fileType: 'text/html',
      metadata: { artboardId: boardId, path: 'pages/index.html' },
      size: 1024,
      source: FileSource.Artboard,
      userId,
    });
  });

  it('replaces the row of a path that is rewritten instead of keeping both versions', async () => {
    const stored = [
      { contentType: 'text/html', key: 's3://bucket/one.html', path: 'index.html', size: 100 },
    ];

    await personal.record(boardId, stored, []);
    await personal.record(
      boardId,
      [
        {
          contentType: 'text/html',
          key: 's3://bucket/two.html',
          path: 'index.html',
          size: 200,
        },
      ],
      [],
    );

    const rows = await rowsOfBoard(boardId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ size: 200, url: 's3://bucket/two.html' });
  });

  it('does nothing when a write neither keeps nor drops a path', async () => {
    await personal.record(boardId, [], []);

    expect(await rowsOfBoard(boardId)).toEqual([]);
  });

  it('only deletes the dropped paths, without touching the kept files', async () => {
    await personal.record(
      boardId,
      [
        { contentType: 'text/html', key: 's3://bucket/a.html', path: 'a.html', size: 10 },
        { contentType: 'text/html', key: 's3://bucket/b.html', path: 'b.html', size: 10 },
      ],
      [],
    );

    await personal.record(boardId, [], ['a.html']);

    expect((await rowsOfBoard(boardId)).map((row) => row.name)).toEqual(['b.html']);
  });

  it('deletes every file of the boards it is given, and nothing for an empty list', async () => {
    await personal.record(
      boardId,
      [{ contentType: 'text/html', key: 's3://bucket/a.html', path: 'a.html', size: 10 }],
      [],
    );
    await personal.record(
      otherBoardId,
      [{ contentType: 'text/html', key: 's3://bucket/b.html', path: 'b.html', size: 10 }],
      [],
    );

    await personal.deleteByArtboards([]);
    expect(await rowsOfBoard(boardId)).toHaveLength(1);

    await personal.deleteByArtboards([boardId]);
    expect(await rowsOfBoard(boardId)).toEqual([]);
    expect(await rowsOfBoard(otherBoardId)).toHaveLength(1);
  });

  it('scopes a workspace board by its workspace, not by who wrote the file', async () => {
    const memberBoard = new ArtboardFileModel(serverDB, otherUserId, workspaceId);
    await memberBoard.record(
      boardId,
      [{ contentType: 'text/html', key: 's3://bucket/ws.html', path: 'ws.html', size: 10 }],
      [],
    );

    const rows = await serverDB
      .select()
      .from(files)
      .where(
        and(
          eq(files.source, FileSource.Artboard),
          eq(files.workspaceId, workspaceId),
        ),
      );
    expect(rows[0]).toMatchObject({ userId: otherUserId, workspaceId });

    // Another member of the same workspace may drop a file this one wrote.
    await inWorkspace.record(boardId, [], ['ws.html']);
    expect(await rowsOfBoard(boardId)).toEqual([]);

    // A personal row that names the same board is out of the workspace's reach.
    const personalUser = new ArtboardFileModel(serverDB, otherUserId);
    await personalUser.record(
      boardId,
      [{ contentType: 'text/html', key: 's3://bucket/p.html', path: 'p.html', size: 10 }],
      [],
    );

    await inWorkspace.deleteByArtboards([boardId]);

    const [personalRow] = await serverDB
      .select()
      .from(files)
      .where(and(eq(files.source, FileSource.Artboard), eq(files.userId, otherUserId)));
    expect(personalRow).toMatchObject({ name: 'p.html', workspaceId: null });
  });
});
