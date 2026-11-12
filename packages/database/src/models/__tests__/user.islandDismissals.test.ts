import { MAX_ISLAND_DISMISSALS } from '@lobechat/const/goal';
import { UserPreferenceSchema } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { UserModel } from '../user';

const userId = 'user-island-dismissals-test';

const serverDB: LobeChatDatabase = await getTestDB();
const userModel = new UserModel(serverDB, userId);

const readPreference = async () =>
  (await serverDB.query.users.findFirst({ where: eq(users.id, userId) }))?.preference as Record<
    string,
    unknown
  >;

describe('UserModel island dismissals', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId, preference: { topicGroupMode: 'byTime' } });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  it('returns an empty list when nothing is stored', async () => {
    expect(await userModel.getIslandDismissals()).toEqual([]);
  });

  it('adds keys once and keeps the other preference fields', async () => {
    await userModel.addIslandDismissals(['goal-decision:d1']);
    const stored = await userModel.addIslandDismissals(['goal-decision:d1', 'goal-sign-off:a1']);

    expect(stored).toEqual(['goal-decision:d1', 'goal-sign-off:a1']);
    expect(await userModel.getIslandDismissals()).toEqual(stored);
    expect(await readPreference()).toMatchObject({ topicGroupMode: 'byTime' });
  });

  it('keeps only the newest keys once the cap is reached', async () => {
    const full = Array.from({ length: MAX_ISLAND_DISMISSALS }, (_, i) => `k${i}`);
    await userModel.addIslandDismissals(full);

    const stored = await userModel.addIslandDismissals(['newest']);

    expect(stored).toHaveLength(MAX_ISLAND_DISMISSALS);
    expect(stored[0]).toBe('k1');
    expect(stored.at(-1)).toBe('newest');
  });

  it('keeps both clients keys when they dismiss at the same time', async () => {
    const other = new UserModel(serverDB, userId);
    await Promise.all([
      userModel.addIslandDismissals(['from-web']),
      other.addIslandDismissals(['from-desktop']),
    ]);

    expect([...(await userModel.getIslandDismissals())].sort()).toEqual([
      'from-desktop',
      'from-web',
    ]);
  });

  it('keeps a dismissal that commits while a preference save waits on the row', async () => {
    let saving: Promise<void> | undefined;
    await serverDB.transaction(async (trx) => {
      await trx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      // On a real server this save starts while the dismissal below holds the
      // row; read without the lock, it would write the old JSON back over it.
      saving = userModel.updatePreference({ topicGroupMode: 'byProject' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await trx
        .update(users)
        .set({ preference: { islandDismissals: ['goal-decision:d1'], topicGroupMode: 'byTime' } })
        .where(eq(users.id, userId));
    });
    await saving;

    expect(await userModel.getIslandDismissals()).toEqual(['goal-decision:d1']);
    expect(await readPreference()).toMatchObject({ topicGroupMode: 'byProject' });
  });

  it('is not overwritten by a stale client saving its whole preference', async () => {
    await userModel.addIslandDismissals(['goal-decision:d1', 'goal-decision:d2']);

    // A client that loaded before d2 sends back its full preference object.
    const stale = UserPreferenceSchema.parse({
      islandDismissals: ['goal-decision:other'],
      topicGroupMode: 'byProject',
    });
    await userModel.updatePreference(stale);

    expect(await userModel.getIslandDismissals()).toEqual(['goal-decision:d1', 'goal-decision:d2']);
    expect(await readPreference()).toMatchObject({ topicGroupMode: 'byProject' });
  });
});
