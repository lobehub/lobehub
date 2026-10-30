// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { NotificationModel } from '../../models/notification';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 't863-notification-cov-user';

// An aggregate without GROUP BY normally yields exactly one row; a driver or
// pooler that drops it must still produce zero counts rather than a crash.
const noAggregateRowDB = createProxyTestDB(serverDB, (query, result) =>
  query.includes('count(') ? [] : result.rows,
);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('NotificationModel coverage', () => {
  it('reports zero linked counts when the aggregate returns no row', async () => {
    const model = new NotificationModel(noAggregateRowDB, userId);

    expect(await model.countLinkedToTransfers(['req-1'])).toEqual({ total: 0, unread: 0 });
  });

  it('reports a zero unread count when the aggregate returns no row', async () => {
    const model = new NotificationModel(noAggregateRowDB, userId);

    expect(await model.getUnreadCount()).toBe(0);
  });
});
