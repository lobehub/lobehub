// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agents, documents, users } from '@/database/schemas';
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
});
