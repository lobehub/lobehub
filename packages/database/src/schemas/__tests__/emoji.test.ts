// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  customEmojis,
  emojiPacks,
  files,
  globalFiles,
  userEmojiPacks,
  users,
  workspaces,
} from '..';

const serverDB = await getTestDB();
const ownerId = 'emoji-schema-owner';
const otherId = 'emoji-schema-other';
const workspaceId = 'emoji-schema-workspace';

const hashId = 'emoji-schema-hash';

/** The uploader's blob plus their own `files` row for it, as an upload leaves them. */
const createImage = async (userId = ownerId) => {
  await serverDB
    .insert(globalFiles)
    .values({ creator: userId, fileType: 'image/png', hashId, size: 1024, url: 'files/doge.png' })
    .onConflictDoNothing();
  await serverDB.insert(files).values({
    fileHash: hashId,
    fileType: 'image/png',
    name: 'doge.png',
    size: 1024,
    url: 'files/doge.png',
    userId,
  });
  return hashId;
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
  await serverDB.delete(globalFiles).where(eq(globalFiles.hashId, hashId));
});

describe('emoji schema', () => {
  it('generates prefixed ids for packs and emojis', async () => {
    const pack = await createPack();
    const fileHash = await createImage();
    const [emoji] = await serverDB
      .insert(customEmojis)
      .values({ fileHash, name: 'doge', packId: pack.id, userId: ownerId })
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
    const fileHash = await createImage();
    const [first] = await serverDB
      .insert(customEmojis)
      .values({ fileHash, name: 'doge', packId: pack.id })
      .returning();

    await expect(
      serverDB.insert(customEmojis).values({ fileHash, name: 'doge', packId: pack.id }),
    ).rejects.toThrow();
    // Another pack may reuse the name and the same image.
    await serverDB.insert(customEmojis).values({ fileHash, name: 'doge', packId: other.id });

    await serverDB
      .update(customEmojis)
      .set({ removedAt: new Date() })
      .where(eq(customEmojis.id, first.id));
    await serverDB.insert(customEmojis).values({ fileHash, name: 'doge', packId: pack.id });
  });

  it('keeps workspace emojis and their image when the uploader is deleted', async () => {
    const pack = await createPack({ scope: 'workspace', userId: null, workspaceId });
    const fileHash = await createImage(otherId);
    const [emoji] = await serverDB
      .insert(customEmojis)
      .values({ fileHash, name: 'doge', packId: pack.id, userId: otherId })
      .returning();

    await serverDB.delete(users).where(eq(users.id, otherId));

    // The uploader's own `files` row goes with the account; the blob the emoji uses stays.
    const [kept] = await serverDB.select().from(customEmojis).where(eq(customEmojis.id, emoji.id));
    expect(kept).toMatchObject({ fileHash, userId: null });
    const ownRows = await serverDB.select().from(files).where(eq(files.fileHash, fileHash));
    expect(ownRows).toHaveLength(0);
    const [blob] = await serverDB
      .select()
      .from(globalFiles)
      .where(eq(globalFiles.hashId, fileHash));
    expect(blob).toBeDefined();
  });

  it('refuses to drop a blob an emoji still uses', async () => {
    const pack = await createPack();
    const fileHash = await createImage();
    await serverDB.insert(customEmojis).values({ fileHash, name: 'doge', packId: pack.id });

    await expect(
      serverDB.delete(globalFiles).where(eq(globalFiles.hashId, fileHash)),
    ).rejects.toThrow();
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
