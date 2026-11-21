// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../core/getTestDB';
import { users } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { createProxyTestDB } from './__tests__/_proxyTestDB';
import { FavoriteModel } from './favorite';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'favorite-guards-user';

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('FavoriteModel.reorder empty-sidebar guard', () => {
  it('writes nothing when the sidebar has no favorites to order', async () => {
    const statements: string[] = [];
    const model = new FavoriteModel(
      createProxyTestDB(serverDB, (query, result) => {
        statements.push(query);
        return result.rows;
      }),
      userId,
    );

    // Ids from another sidebar are ignored, which leaves nothing to position.
    await expect(model.reorder(['fav-from-elsewhere'])).resolves.toBeUndefined();

    expect(statements.filter((query) => query.startsWith('update'))).toEqual([]);
    expect(await new FavoriteModel(serverDB, userId).query()).toEqual([]);
  });
});
