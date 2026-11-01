// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { acceptances } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceCommentRouter } from '../acceptanceComment';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

const source = {
  intent: 'comment' as const,
  scroll: { x: 0, y: 120 },
  targets: [{ label: 'Pay', rect: { height: 40, width: 120, x: 10, y: 20 }, selector: '#pay' }],
  url: 'https://preview.example.com/checkout',
  v: 1 as const,
  viewport: { dpr: 2, height: 800, width: 1280 },
};

describe('acceptanceCommentRouter product-page source', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let acceptanceId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    ownerId = await createTestUser(serverDB);
    const [row] = await serverDB
      .insert(acceptances)
      .values({ subjectId: randomUUID(), subjectType: 'standalone', userId: ownerId })
      .returning();
    acceptanceId = row.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, ownerId);
    vi.clearAllMocks();
  });

  const caller = (userId = ownerId) =>
    acceptanceCommentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  it('stores the page anchor on a thread root and returns it on list', async () => {
    const { data } = await caller().create({
      acceptanceId,
      clientId: `c-${randomUUID()}`,
      content: 'button overlaps the total',
      source,
    });
    expect(data.source).toEqual(source);

    const { items } = await caller().list({ acceptanceId });
    expect(items.find((item) => item.id === data.id)?.source).toEqual(source);
  });

  it('refuses a source on a reply', async () => {
    const { data: root } = await caller().create({
      acceptanceId,
      clientId: `c-${randomUUID()}`,
      content: 'root',
    });
    await expect(
      caller().create({
        acceptanceId,
        clientId: `c-${randomUUID()}`,
        content: 'reply',
        parentCommentId: root.id,
        source,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('shows the reporter environment only to its author and moderators', async () => {
    const env = { consoleErrors: ['GET /api?token=secret 500'], userAgent: 'Chrome' };
    const reader = await createTestUser(serverDB);
    await caller(reader).create({
      acceptanceId,
      clientId: `c-${randomUUID()}`,
      content: 'diagnostics attached',
      source: { ...source, env },
    });

    const anonymous = acceptanceCommentRouter.createCaller({ userId: null } as any);
    const [forAnonymous] = (await anonymous.list({ acceptanceId })).items;
    const [forOwner] = (await caller().list({ acceptanceId })).items;
    const [forAuthor] = (await caller(reader).list({ acceptanceId })).items;
    await cleanupTestUser(serverDB, reader);

    expect(forAnonymous.source?.env).toBeUndefined();
    expect(forOwner.source?.env).toEqual(env);
    expect(forAuthor.source?.env).toEqual(env);
  });
});
