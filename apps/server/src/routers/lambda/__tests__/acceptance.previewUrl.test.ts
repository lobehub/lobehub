// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { acceptances, verifyRuns } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceRouter } from '../acceptance';
import { createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

describe('acceptanceRouter.setPreviewUrl', () => {
  let ownerId: string;
  let acceptanceId: string;
  let latestRunId: string;
  let firstRunId: string;

  beforeEach(async () => {
    testDB = await getTestDB();
    ownerId = await createTestUser(testDB);
    const [row] = await testDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: ownerId })
      .returning();
    acceptanceId = row.id;
    const [first, latest] = await testDB
      .insert(verifyRuns)
      .values([
        { acceptanceId, roundIndex: 1, userId: ownerId },
        { acceptanceId, metadata: { note: 'kept' }, roundIndex: 2, userId: ownerId },
      ])
      .returning();
    firstRunId = first.id;
    latestRunId = latest.id;
  });

  const caller = (userId = ownerId) =>
    acceptanceRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  const metadataOf = async (id: string) =>
    (await testDB.query.verifyRuns.findFirst({ where: eq(verifyRuns.id, id) }))?.metadata;

  it('records the preview on the latest round and keeps its other metadata', async () => {
    await caller().setPreviewUrl({ id: acceptanceId, url: 'https://pr-12.preview.example.com/' });

    expect(await metadataOf(latestRunId)).toEqual({
      note: 'kept',
      previewUrl: 'https://pr-12.preview.example.com/',
    });
    expect(await metadataOf(firstRunId)).toBeNull();
  });

  it('accepts a loopback dev server', async () => {
    await caller().setPreviewUrl({ id: acceptanceId, url: 'http://localhost:5173/app' });
    await caller().setPreviewUrl({ id: acceptanceId, url: 'http://127.0.0.1:3000/' });

    expect((await metadataOf(latestRunId))?.previewUrl).toBe('http://127.0.0.1:3000/');
  });

  it('refuses plain http on a public host and non-web schemes', async () => {
    for (const url of [
      'http://preview.example.com/',
      'javascript:alert(1)',
      'ftp://x.example.com/',
    ])
      await expect(caller().setPreviewUrl({ id: acceptanceId, url })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
  });

  it('hides a private acceptance from someone who cannot read it', async () => {
    await testDB
      .update(acceptances)
      .set({ visibility: 'private' })
      .where(eq(acceptances.id, acceptanceId));
    const stranger = await createTestUser(testDB);
    await expect(
      caller(stranger).setPreviewUrl({ id: acceptanceId, url: 'https://x.example.com/' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tells a reader of a public acceptance that they cannot change it', async () => {
    const stranger = await createTestUser(testDB);
    await expect(
      caller(stranger).setPreviewUrl({ id: acceptanceId, url: 'https://x.example.com/' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await metadataOf(latestRunId))?.previewUrl).toBeUndefined();
  });

  it('needs a round to attach the preview to', async () => {
    const [empty] = await testDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: ownerId })
      .returning();
    await expect(
      caller().setPreviewUrl({ id: empty.id, url: 'https://x.example.com/' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
