// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  agents,
  documents,
  files,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { getResourceMeta } from './index';

const serverDB: LobeChatDatabase = await getTestDB();
const userId = 'resource-meta-soft-delete-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('getResourceMeta', () => {
  it('returns live agents and hides soft-deleted agents', async () => {
    await serverDB.insert(agents).values({ id: 'resource-meta-agent', userId });

    await expect(getResourceMeta(serverDB, 'agent', 'resource-meta-agent')).resolves.toMatchObject({
      userId,
    });

    await serverDB
      .update(agents)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(agents.id, 'resource-meta-agent'));

    await expect(getResourceMeta(serverDB, 'agent', 'resource-meta-agent')).resolves.toBeNull();
  });

  it('returns live shared-table resources and hides them after soft delete', async () => {
    await serverDB.insert(documents).values({
      fileType: 'custom/page',
      id: 'resource-meta-document',
      source: '',
      sourceType: 'api',
      title: 'Page',
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    });

    await expect(
      getResourceMeta(serverDB, 'document', 'resource-meta-document'),
    ).resolves.toMatchObject({ userId });

    await serverDB
      .update(documents)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(documents.id, 'resource-meta-document'));

    await expect(
      getResourceMeta(serverDB, 'document', 'resource-meta-document'),
    ).resolves.toBeNull();
  });

  it('hides live documents exclusive to a trashed library and preserves shared documents', async () => {
    await serverDB.insert(knowledgeBases).values([
      {
        id: 'resource-meta-kb-trashed',
        isDeleted: true,
        name: 'Trashed library',
        userId,
      },
      { id: 'resource-meta-kb-live', name: 'Live library', userId },
    ]);
    await serverDB.insert(files).values([
      {
        fileType: 'text/plain',
        id: 'resource-meta-file-exclusive',
        name: 'Exclusive',
        size: 1,
        url: 'file://exclusive',
        userId,
      },
      {
        fileType: 'text/plain',
        id: 'resource-meta-file-shared',
        name: 'Shared',
        size: 1,
        url: 'file://shared',
        userId,
      },
    ]);
    await serverDB.insert(knowledgeBaseFiles).values([
      {
        fileId: 'resource-meta-file-exclusive',
        knowledgeBaseId: 'resource-meta-kb-trashed',
        userId,
      },
      {
        fileId: 'resource-meta-file-shared',
        knowledgeBaseId: 'resource-meta-kb-trashed',
        userId,
      },
      {
        fileId: 'resource-meta-file-shared',
        knowledgeBaseId: 'resource-meta-kb-live',
        userId,
      },
    ]);
    await serverDB.insert(documents).values([
      {
        fileType: 'custom/document',
        id: 'resource-meta-inline-exclusive',
        knowledgeBaseId: 'resource-meta-kb-trashed',
        source: '',
        sourceType: 'api',
        title: 'Inline exclusive',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
      },
      {
        fileId: 'resource-meta-file-exclusive',
        fileType: 'text/plain',
        id: 'resource-meta-file-backed-exclusive',
        source: 'file://exclusive',
        sourceType: 'file',
        title: 'File backed exclusive',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
      },
      {
        fileId: 'resource-meta-file-shared',
        fileType: 'text/plain',
        id: 'resource-meta-file-backed-shared',
        knowledgeBaseId: 'resource-meta-kb-trashed',
        source: 'file://shared',
        sourceType: 'file',
        title: 'File backed shared',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
      },
    ]);

    await expect(
      getResourceMeta(serverDB, 'document', 'resource-meta-inline-exclusive'),
    ).resolves.toBeNull();
    await expect(
      getResourceMeta(serverDB, 'document', 'resource-meta-file-backed-exclusive'),
    ).resolves.toBeNull();
    await expect(
      getResourceMeta(serverDB, 'document', 'resource-meta-file-backed-shared'),
    ).resolves.toMatchObject({ userId });
  });
});
