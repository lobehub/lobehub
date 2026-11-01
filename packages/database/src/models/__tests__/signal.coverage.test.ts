// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SignalModel } from '../signal';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'signal-coverage-user';
const otherUserId = 'signal-coverage-other';

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  // Signals cascade from their owning user.
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('SignalModel coverage', () => {
  describe('findById', () => {
    it("returns the user's own signal and hides another user's", async () => {
      const signal = await new SignalModel(serverDB, userId).record({
        externalId: 'signal-coverage-1',
        payload: { text: 'hello' },
        scopeKey: 'discord:app-1:thread-1',
        source: 'bot:discord',
        type: 'bot.message.merged',
      });

      expect(await new SignalModel(serverDB, userId).findById(signal!.id)).toMatchObject({
        externalId: 'signal-coverage-1',
        id: signal!.id,
        userId,
      });
      expect(await new SignalModel(serverDB, otherUserId).findById(signal!.id)).toBeUndefined();
    });

    it('returns undefined for an unknown id', async () => {
      expect(
        await new SignalModel(serverDB, userId).findById('00000000-0000-0000-0000-000000000000'),
      ).toBeUndefined();
    });
  });
});
