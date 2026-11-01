// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { files, globalFiles, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { CanvasFileModel } from '../canvasFile';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'canvascov-user';
const hash = 'canvascov-hash-1';
const blob = {
  contentType: 'image/png',
  hash,
  name: 'a.png',
  size: 1,
  url: 'files/canvascov-a.png',
};

const cleanup = async () => {
  // files cascade from the owning user; `global_files.creator` is NOT NULL with
  // ON DELETE SET NULL, so its row has to go first.
  await serverDB.delete(files).where(eq(files.userId, userId));
  await serverDB.delete(globalFiles).where(eq(globalFiles.hashId, hash));
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('CanvasFileModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
    await serverDB
      .insert(globalFiles)
      .values({ creator: userId, fileType: 'image/png', hashId: hash, size: 1, url: blob.url });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('returns no rows for an empty hash list', async () => {
    const model = new CanvasFileModel(serverDB, userId);
    await model.insertFiles('canvas-1', [blob]);

    expect(await model.listByHashes([])).toEqual([]);
  });

  it('inserts nothing for an empty blob list', async () => {
    const model = new CanvasFileModel(serverDB, userId);

    await expect(model.insertFiles('canvas-1', [])).resolves.toBeUndefined();

    expect(await serverDB.select().from(files).where(eq(files.userId, userId))).toEqual([]);
  });

  it('returns no orphaned urls when the canvas owns no files', async () => {
    const model = new CanvasFileModel(serverDB, userId);
    await model.insertFiles('canvas-1', [blob]);

    expect(await model.deleteByCanvas('canvas-unknown')).toEqual([]);
    expect(await serverDB.select().from(files).where(eq(files.userId, userId))).toHaveLength(1);
  });
});
