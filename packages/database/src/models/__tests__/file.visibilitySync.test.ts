// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, files, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { FileModel } from '../file';

const ownerId = 'visibility-sync-owner';
const memberId = 'visibility-sync-member';
const workspaceId = 'visibility-sync-ws';
const fileId = 'visibility-sync-file';
const serverDB: LobeChatDatabase = await getTestDB();
const ownerFiles = new FileModel(serverDB, ownerId, workspaceId);

const documentVisibility = async (id: string) =>
  (await serverDB.query.documents.findFirst({ where: eq(documents.id, id) }))?.visibility;

const insertDocument = (id: string, overrides: Partial<typeof documents.$inferInsert> = {}) =>
  serverDB.insert(documents).values({
    content: 'parsed text',
    fileId,
    fileType: 'custom/document',
    filename: id,
    id,
    source: 's3://bucket/file',
    sourceType: 'file',
    title: id,
    totalCharCount: 11,
    totalLineCount: 1,
    userId: ownerId,
    visibility: 'private',
    workspaceId,
    ...overrides,
  });

const insertFile = (visibility: 'private' | 'public', userId = ownerId) =>
  serverDB.insert(files).values({
    fileType: 'text/markdown',
    id: fileId,
    name: 'policy.md',
    size: 10,
    url: 's3://bucket/file',
    userId,
    visibility,
    workspaceId,
  });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB.insert(workspaces).values({
    id: workspaceId,
    name: 'Visibility Sync',
    primaryOwnerId: ownerId,
    slug: 'visibility-sync',
  });
});

describe('FileModel.setVisibility parsed document sync', () => {
  it('publishes the parsed document with its file', async () => {
    await insertFile('private');
    await insertDocument('parsed');

    await ownerFiles.setVisibility(fileId, 'public');

    expect(await documentVisibility('parsed')).toBe('public');
  });

  it('hides a parsed document another member created when the file goes private', async () => {
    await insertFile('public');
    await insertDocument('parsed-by-member', { userId: memberId, visibility: 'public' });

    await ownerFiles.setVisibility(fileId, 'private');

    expect(await documentVisibility('parsed-by-member')).toBe('private');
  });

  it('leaves a document that is not parsed from the file alone', async () => {
    await insertFile('private');
    await insertDocument('page', { sourceType: 'editor' });

    await ownerFiles.setVisibility(fileId, 'public');

    expect(await documentVisibility('page')).toBe('private');
  });

  it('changes nothing when the caller may not change the file', async () => {
    await insertFile('private', memberId);
    await insertDocument('parsed', { userId: memberId });

    await ownerFiles.setVisibility(fileId, 'public');

    expect(await documentVisibility('parsed')).toBe('private');
  });
});
