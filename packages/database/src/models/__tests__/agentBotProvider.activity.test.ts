// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentBotProviders, agents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentBotProviderModel } from '../agentBotProvider';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'bot-activity-test-user';
const otherUserId = 'bot-activity-test-user-2';
const agentId = 'bot-activity-test-agent';
const otherAgentId = 'bot-activity-test-agent-2';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-20T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const updatedAt = new Date('2026-10-01T00:00:00.000Z');

const seedBot = async (
  applicationId: string,
  values: Partial<typeof agentBotProviders.$inferInsert> = {},
) => {
  const [row] = await serverDB
    .insert(agentBotProviders)
    .values({
      agentId,
      applicationId,
      credentials: '{"botToken":"secret"}',
      platform: 'discord',
      updatedAt,
      userId,
      ...values,
    })
    .returning();
  return row;
};

const readBot = async (id: string) => {
  const [row] = await serverDB.select().from(agentBotProviders).where(eq(agentBotProviders.id, id));
  return row;
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(agents).values([
    { id: agentId, userId },
    { id: otherAgentId, userId: otherUserId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(agentBotProviders);
  await serverDB.delete(agents);
  await serverDB.delete(users);
});

describe('AgentBotProviderModel activity', () => {
  it('starts the idle clock when a bot is created', async () => {
    const before = Date.now();
    const model = new AgentBotProviderModel(serverDB, userId);
    const created = await model.create({
      agentId,
      applicationId: 'new-app',
      credentials: { botToken: 't' },
      platform: 'discord',
    });

    const row = await readBot(created.id);
    expect(row.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  describe('markActive', () => {
    it("restarts the owner's bot clock without bumping updatedAt", async () => {
      const bot = await seedBot('app-1', { lastActiveAt: daysAgo(20) });
      const model = new AgentBotProviderModel(serverDB, userId);

      const result = await model.markActive('discord', 'app-1', now);

      expect(result).toEqual({ id: bot.id, previousLastActiveAt: daysAgo(20) });
      const row = await readBot(bot.id);
      expect(row.lastActiveAt).toEqual(now);
      expect(row.updatedAt).toEqual(updatedAt);
    });

    it("does not touch another user's bot", async () => {
      const bot = await seedBot('app-2', {
        agentId: otherAgentId,
        lastActiveAt: daysAgo(20),
        userId: otherUserId,
      });
      const model = new AgentBotProviderModel(serverDB, userId);

      expect(await model.markActive('discord', 'app-2', now)).toBeUndefined();
      expect((await readBot(bot.id)).lastActiveAt).toEqual(daysAgo(20));
    });
  });

  describe('touchActivity', () => {
    it('records a reply on a stale bot, whoever owns it', async () => {
      const bot = await seedBot('app-3', {
        agentId: otherAgentId,
        lastActiveAt: daysAgo(3),
        userId: otherUserId,
      });

      expect(await AgentBotProviderModel.touchActivity(serverDB, 'discord', 'app-3', { now })).toBe(
        true,
      );
      const row = await readBot(bot.id);
      expect(row.lastActiveAt).toEqual(now);
      expect(row.updatedAt).toEqual(updatedAt);
    });

    it('skips the write while the last activity is younger than the interval', async () => {
      const recent = new Date(now.getTime() - 10 * 60 * 1000);
      const bot = await seedBot('app-4', { lastActiveAt: recent });

      expect(await AgentBotProviderModel.touchActivity(serverDB, 'discord', 'app-4', { now })).toBe(
        false,
      );
      expect((await readBot(bot.id)).lastActiveAt).toEqual(recent);
    });
  });

  describe('wakeIdleByUser', () => {
    it("wakes only the user's enabled bots idle past the cutoff", async () => {
      const asleep = await seedBot('asleep', { lastActiveAt: daysAgo(15) });
      const warned = await seedBot('warned', { lastActiveAt: daysAgo(13) });
      const disabled = await seedBot('disabled', { enabled: false, lastActiveAt: daysAgo(15) });
      const others = await seedBot('others', {
        agentId: otherAgentId,
        lastActiveAt: daysAgo(15),
        userId: otherUserId,
      });

      const woke = await AgentBotProviderModel.wakeIdleByUser(serverDB, userId, daysAgo(14), now);

      expect(woke).toEqual([{ applicationId: 'asleep', id: asleep.id, platform: 'discord' }]);
      expect((await readBot(asleep.id)).lastActiveAt).toEqual(now);
      expect((await readBot(asleep.id)).updatedAt).toEqual(updatedAt);
      expect((await readBot(warned.id)).lastActiveAt).toEqual(daysAgo(13));
      expect((await readBot(disabled.id)).lastActiveAt).toEqual(daysAgo(15));
      expect((await readBot(others.id)).lastActiveAt).toEqual(daysAgo(15));
    });
  });

  describe('listIdleEnabled', () => {
    it('pages enabled bots inside the idle window by id, without credentials', async () => {
      const a = await seedBot('a', { lastActiveAt: daysAgo(12.5) });
      const b = await seedBot('b', { lastActiveAt: daysAgo(14.5) });
      const c = await seedBot('c', { lastActiveAt: daysAgo(13) });
      await seedBot('fresh', { lastActiveAt: daysAgo(2) });
      await seedBot('long-asleep', { lastActiveAt: daysAgo(30) });
      await seedBot('off', { enabled: false, lastActiveAt: daysAgo(13) });

      const params = { idleAfter: daysAgo(16), idleBefore: daysAgo(12) };
      const ids = [a.id, b.id, c.id].sort();

      const first = await AgentBotProviderModel.listIdleEnabled(serverDB, { ...params, limit: 2 });
      expect(first.map((row) => row.id)).toEqual(ids.slice(0, 2));
      expect(first[0]).not.toHaveProperty('credentials');

      const second = await AgentBotProviderModel.listIdleEnabled(serverDB, {
        ...params,
        afterId: first.at(-1)!.id,
        limit: 2,
      });
      expect(second.map((row) => row.id)).toEqual(ids.slice(2));
    });
  });
});
