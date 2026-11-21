// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'doc-query-parent-user';

const insertDocument = async (
  id: string,
  parentId: string | null,
  fileType = 'custom/document',
) => {
  await serverDB.insert(documents).values({
    fileType,
    id,
    parentId,
    source: 'document',
    sourceType: 'api',
    title: id,
    totalCharCount: 0,
    totalLineCount: 0,
    userId,
  });
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: userId });
  await insertDocument('folder', null, 'custom/folder');
  await insertDocument('subfolder', 'folder', 'custom/folder');
  await insertDocument('child-1', 'folder');
  await insertDocument('child-2', 'folder');
  await insertDocument('grandchild', 'subfolder');
  await insertDocument('root-page', null);
});

afterEach(async () => {
  await serverDB.delete(documents);
  await serverDB.delete(users);
});

describe('DocumentModel.query — parentId', () => {
  it('lists only the direct children of the folder', async () => {
    const result = await new DocumentModel(serverDB, userId).query({ parentId: 'folder' });

    expect(result.items.map((item) => item.id).sort()).toEqual(['child-1', 'child-2', 'subfolder']);
    expect(result.total).toBe(3);
  });

  it('pages by an explicit offset with the same total', async () => {
    const model = new DocumentModel(serverDB, userId);
    const first = await model.query({ pageSize: 2, parentId: 'folder', sortBy: 'title' });
    const rest = await model.query({ offset: 2, pageSize: 2, parentId: 'folder', sortBy: 'title' });

    expect(first.items.map((item) => item.id)).toEqual(['child-1', 'child-2']);
    expect(rest.items.map((item) => item.id)).toEqual(['subfolder']);
    expect(rest.total).toBe(3);
  });
});
