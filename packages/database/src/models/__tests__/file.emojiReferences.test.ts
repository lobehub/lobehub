// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { customEmojis, emojiPacks, globalFiles, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'file-emoji-refs-user';
const fileModel = new FileModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(globalFiles).where(eq(globalFiles.creator, userId));
});

const upload = async (hash: string) => {
  const { id } = await fileModel.create(
    { fileHash: hash, fileType: 'image/png', name: `${hash}.png`, size: 1, url: `files/${hash}` },
    true,
  );
  return id;
};

/** Saves the blob as a custom emoji, which references it by hash only. */
const saveAsEmoji = async (hash: string) => {
  const [pack] = await serverDB
    .insert(emojiPacks)
    .values({ kind: 'pack', scope: 'user', title: 'Pack', userId })
    .returning();
  await serverDB.insert(customEmojis).values({ fileHash: hash, name: hash, packId: pack.id });
};

const blobExists = async (hash: string) =>
  (await serverDB.select().from(globalFiles).where(eq(globalFiles.hashId, hash))).length > 0;

describe('FileModel custom emoji references', () => {
  it('delete keeps a blob a custom emoji still uses', async () => {
    const used = await upload('emoji-refs-used');
    const unused = await upload('emoji-refs-unused');
    await saveAsEmoji('emoji-refs-used');

    expect(await fileModel.delete(used)).toBeUndefined();
    expect(await fileModel.delete(unused)).toMatchObject({ id: unused });

    expect(await blobExists('emoji-refs-used')).toBe(true);
    expect(await blobExists('emoji-refs-unused')).toBe(false);
  });

  it('deleteMany keeps a blob a custom emoji still uses', async () => {
    const used = await upload('emoji-refs-batch-used');
    const unused = await upload('emoji-refs-batch-unused');
    await saveAsEmoji('emoji-refs-batch-used');

    const removed = await fileModel.deleteMany([used, unused]);

    expect(removed.map((file) => file.id)).toEqual([unused]);
    expect(await blobExists('emoji-refs-batch-used')).toBe(true);
    expect(await blobExists('emoji-refs-batch-unused')).toBe(false);
  });
});
