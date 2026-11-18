// @vitest-environment node
import { FileSource } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { customEmojis, emojiPacks, files, userEmojiPacks, users, workspaces } from '..';

const serverDB = await getTestDB();
const ownerId = 'emoji-schema-owner';
const otherId = 'emoji-schema-other';
const workspaceId = 'emoji-schema-workspace';

const createFile = async (userId = ownerId) => {
  const [file] = await serverDB
    .insert(files)
    .values({
      fileType: 'image/png',
      name: 'doge.png',
      size: 1024,
      source: FileSource.CustomEmoji,
      url: 'files/doge.png',
      userId,
    })
    .returning();
  return file;
};

const createPack = async (values: Partial<typeof emojiPacks.$inferInsert> = {}) => {
  const [pack] = await serverDB
    .insert(emojiPacks)
    .values({ kind: 'pack', scope: 'user', title: 'Pack', userId: ownerId, ...values })
    .returning();
  return pack;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: ownerId }, { id: otherId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Workspace', primaryOwnerId: ownerId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(emojiPacks).where(eq(emojiPacks.workspaceId, workspaceId));
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, otherId]));
});

describe('emoji schema', () => {
  it('generates prefixed ids for packs and emojis', async () => {
    const pack = await createPack();
    const file = await createFile();
    const [emoji] = await serverDB
      .insert(customEmojis)
      .values({ fileId: file.id, name: 'doge', packId: pack.id, userId: ownerId })
      .returning();

    expect(pack.id).toMatch(/^epk_/);
    expect(pack.visibility).toBe('private');
    expect(emoji.id).toMatch(/^emj_/);
    expect(emoji).toMatchObject({ animated: false, boundEmojis: [], keywords: [], sortOrder: 0 });
  });

  it('requires a user pack to belong to a person only', async () => {
    await expect(createPack({ userId: null })).rejects.toThrow();
    await expect(createPack({ workspaceId })).rejects.toThrow();
  });

  it('requires a workspace pack to belong to a workspace only', async () => {
    await expect(
      createPack({ scope: 'workspace', userId: null, workspaceId }),
    ).resolves.toMatchObject({ workspaceId });
    await expect(createPack({ scope: 'workspace', userId: null })).rejects.toThrow();
    await expect(createPack({ scope: 'workspace', workspaceId })).rejects.toThrow();
  });

  it('allows favorites only on a personal pack, once per person', async () => {
    await expect(
      createPack({ kind: 'favorites', scope: 'workspace', userId: null, workspaceId }),
    ).rejects.toThrow();

    const favorites = await createPack({ kind: 'favorites' });
    await expect(createPack({ kind: 'favorites' })).rejects.toThrow();

    // A removed favorites pack frees the slot.
    await serverDB
      .update(emojiPacks)
      .set({ removedAt: new Date() })
      .where(eq(emojiPacks.id, favorites.id));
    await expect(createPack({ kind: 'favorites' })).resolves.toMatchObject({ kind: 'favorites' });
  });

  it('keeps names unique among live emojis in one pack', async () => {
    const pack = await createPack();
    const other = await createPack();
    const file = await createFile();
    const [first] = await serverDB
      .insert(customEmojis)
      .values({ fileId: file.id, name: 'doge', packId: pack.id })
      .returning();

    await expect(
      serverDB.insert(customEmojis).values({ fileId: file.id, name: 'doge', packId: pack.id }),
    ).rejects.toThrow();
    // Another pack may reuse the name and the same image.
    await serverDB.insert(customEmojis).values({ fileId: file.id, name: 'doge', packId: other.id });

    await serverDB
      .update(customEmojis)
      .set({ removedAt: new Date() })
      .where(eq(customEmojis.id, first.id));
    await serverDB.insert(customEmojis).values({ fileId: file.id, name: 'doge', packId: pack.id });
  });

  it('keeps workspace emojis when their uploader is deleted', async () => {
    const pack = await createPack({ scope: 'workspace', userId: null, workspaceId });
    const file = await createFile(ownerId);
    const [emoji] = await serverDB
      .insert(customEmojis)
      .values({ fileId: file.id, name: 'doge', packId: pack.id, userId: otherId })
      .returning();

    await serverDB.delete(users).where(eq(users.id, otherId));

    const [kept] = await serverDB.select().from(customEmojis).where(eq(customEmojis.id, emoji.id));
    expect(kept.userId).toBeNull();
  });

  it('adds a pack to a person once and drops it with the pack', async () => {
    const pack = await createPack();
    await serverDB.insert(userEmojiPacks).values({ packId: pack.id, userId: otherId });
    await expect(
      serverDB.insert(userEmojiPacks).values({ packId: pack.id, userId: otherId }),
    ).rejects.toThrow();

    await serverDB.delete(emojiPacks).where(eq(emojiPacks.id, pack.id));
    const rows = await serverDB
      .select()
      .from(userEmojiPacks)
      .where(eq(userEmojiPacks.packId, pack.id));
    expect(rows).toHaveLength(0);
  });
});
