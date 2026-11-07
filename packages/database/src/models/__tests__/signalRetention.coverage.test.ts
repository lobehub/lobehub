// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { signals, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DEFAULT_SIGNAL_PAYLOAD_TTL_MS, SignalRetentionModel } from '../signalRetention';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'signal-retention-coverage-user';

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
});

afterEach(async () => {
  // Signals cascade from their owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('SignalRetentionModel coverage', () => {
  describe('purgeExpiredPayloads', () => {
    it('defaults to the current time and the default payload TTL', async () => {
      const hour = 60 * 60 * 1000;
      const seed = (externalId: string, ageMs: number) =>
        serverDB.insert(signals).values({
          createdAt: new Date(Date.now() - ageMs),
          externalId,
          payload: { text: externalId },
          scopeKey: 'discord:app-1:thread-1',
          source: 'bot:discord',
          type: 'bot.message.merged',
          userId,
        });
      await seed('src-expired', DEFAULT_SIGNAL_PAYLOAD_TTL_MS + hour);
      await seed('src-fresh', DEFAULT_SIGNAL_PAYLOAD_TTL_MS - hour);

      const result = await SignalRetentionModel.purgeExpiredPayloads(serverDB);

      expect(result.purged).toBeGreaterThanOrEqual(1);
      const rows = await serverDB
        .select()
        .from(signals)
        .where(inArray(signals.externalId, ['src-expired', 'src-fresh']));
      const byId = Object.fromEntries(rows.map((r) => [r.externalId, r]));
      expect(byId['src-expired']).toMatchObject({ payload: {}, payloadPurgedAt: expect.any(Date) });
      expect(byId['src-fresh']).toMatchObject({
        payload: { text: 'src-fresh' },
        payloadPurgedAt: null,
      });
    });
  });
});
