// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  SchedulerRunTarget,
  WakeScheduler as WakeSchedulerClass,
} from '../agentSignal/scenarios/botWake/scheduler';
import type { botWake } from './botWake';

/**
 * Runs the bot-wake Redis domain and the scheduler against a real Redis (Lua scripts, the
 * lock, TTLs). Skipped unless `BOT_WAKE_REAL_REDIS_URL` points at a disposable instance:
 *
 *   docker run -d -p 127.0.0.1:6391:6379 redis:7-alpine
 *   BOT_WAKE_REAL_REDIS_URL=redis://127.0.0.1:6391 vitest run apps/server/src/services/redis/botWake.realRedis.test.ts
 */
const url = process.env.BOT_WAKE_REAL_REDIS_URL;

describe.skipIf(!url)('botWake redis domain (real Redis)', () => {
  const prefix = `botwake-test-${Date.now()}`;
  let domain: typeof botWake;
  let WakeScheduler: typeof WakeSchedulerClass;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.REDIS_URL = url;
    process.env.REDIS_PREFIX = prefix;
    domain = (await import('./botWake')).botWake;
    WakeScheduler = (await import('../agentSignal/scenarios/botWake/scheduler')).WakeScheduler;
    const { default: IORedis } = await import('ioredis');
    const raw = new IORedis(url!);
    cleanup = async () => {
      const keys = await raw.keys(`${prefix}:*`);
      if (keys.length > 0) await raw.del(...keys);
      raw.disconnect();
    };
  });

  afterAll(async () => {
    await cleanup?.();
  });

  it('opens the window on the thread the bot spoke in, not on its whole channel', async () => {
    const keys = ['discord:app:g:c1', 'discord:app:g:c1:t1'];
    await domain.recordBotSpoke(keys, 1_000, 300_000);

    expect(await domain.readChannel(keys)).toMatchObject({
      botLastSpokeAt: 1_000,
      followupUntil: 301_000,
      silentWakes: 0,
    });
    // The parent channel and its other threads are not a follow-up to the reply in t1.
    const channelOnly = await domain.readChannel([keys[0]]);
    expect(channelOnly?.followupUntil).toBeUndefined();
    const otherThread = await domain.readChannel(['discord:app:g:c1', 'discord:app:g:c1:t2']);
    expect(otherThread?.followupUntil).toBeUndefined();
  });

  it('opens the channel window when the bot spoke in the channel itself', async () => {
    await domain.recordBotSpoke(['discord:app:g:c4'], 1_000, 300_000);

    expect(await domain.readChannel(['discord:app:g:c4'])).toMatchObject({
      followupUntil: 301_000,
    });
  });

  it('keeps who woke the bot with the window of that conversation', async () => {
    const keys = ['discord:app:g:c5', 'discord:app:g:c5:t1'];
    await domain.recordWakeAuthor(keys[1], 'u1');
    await domain.recordBotSpoke(keys, 1_000, 300_000);

    expect(await domain.readChannel(keys)).toMatchObject({
      followupAuthorId: 'u1',
      followupUntil: 301_000,
    });
  });

  it('counts silent wakes and resets them when the bot speaks', async () => {
    const keys = ['discord:app:g:c2', 'discord:app:g:c2:t2'];

    expect(await domain.recordSilentWake(keys)).toBe(1);
    expect(await domain.recordSilentWake(keys)).toBe(2);
    expect(await domain.recordSilentWake(keys)).toBe(3);
    expect(await domain.readChannel([keys[1]])).toMatchObject({ silentWakes: 3 });

    await domain.recordBotSpoke(keys, 5_000, 60_000);
    expect(await domain.readChannel(keys)).toMatchObject({ silentWakes: 0 });
    expect(await domain.recordSilentWake(keys)).toBe(1);
  });

  it('remembers when the owner last spoke without touching the bot fields', async () => {
    const keys = ['discord:app:g:c3'];
    await domain.recordBotSpoke(keys, 1_000, 60_000);
    await domain.recordOwnerSpoke(keys, 9_000);

    expect(await domain.readChannel(keys)).toMatchObject({
      botLastSpokeAt: 1_000,
      ownerLastSpokeAt: 9_000,
    });
  });

  it('counts classifier calls per bot per hour', async () => {
    expect(await domain.countClassifierCall('app-x', '2026-10-24T06')).toBe(1);
    expect(await domain.countClassifierCall('app-x', '2026-10-24T06')).toBe(2);
    expect(await domain.countClassifierCall('app-x', '2026-10-24T07')).toBe(1);
  });

  it('serializes concurrent scheduler writers: one batch, one run', async () => {
    let now = 1_000_000;
    const runs: SchedulerRunTarget[] = [];
    const flushes: { at: number }[] = [];
    const scheduler = new WakeScheduler({
      delayQueue: { scheduleFlush: async (input) => void flushes.push(input) },
      now: () => now,
      options: { collectMs: 20_000, cooldownMs: 60_000 },
      startRun: async (target) => void runs.push(target),
      store: { mutate: (key, mutate) => domain.mutateScheduler(key, mutate) },
    });

    const verdicts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        scheduler.submit({ channelKey: 'chan-1', messages: [{ id: `m${index}`, threadId: 't' }] }),
      ),
    );
    expect(verdicts).toEqual(Array.from({ length: 8 }, () => 'hold'));
    expect(flushes).toHaveLength(1);

    now += 20_000;
    await Promise.all([scheduler.flush('chan-1'), scheduler.flush('chan-1')]);
    expect(runs).toHaveLength(1);
    expect(runs[0].messageIds).toHaveLength(8);

    await scheduler.runDone('chan-1');
    await scheduler.submit({ channelKey: 'chan-1', messages: [{ id: 'late', threadId: 't' }] });
    now += 59_000;
    await scheduler.flush('chan-1');
    expect(runs).toHaveLength(1);
    now += 1_000;
    await scheduler.flush('chan-1');
    expect(runs).toHaveLength(2);
  });

  it('returns undefined instead of throwing when the lock is held elsewhere', async () => {
    const { default: IORedis } = await import('ioredis');
    const raw = new IORedis(url!);
    await raw.set(`${prefix}:bot-wake:scheduler_lock:v1:locked-chan`, 'someone-else', 'PX', 5000);

    const result = await domain.mutateScheduler('locked-chan', (state) => ({
      result: 'ran',
      state: state ?? ({ pending: [], phase: 'idle', released: [] } as never),
    }));
    raw.disconnect();

    expect(result).toBeUndefined();
  });

  it('lets one edit wake the bot on a message that never engaged it, and only once', async () => {
    expect(await domain.claimEditWake('app', 'fresh')).toBe(true);
    // A second edit of the same message, or a redelivery, does not wake it again.
    expect(await domain.claimEditWake('app', 'fresh')).toBe(false);
    // Another bot in the channel may still be woken by its own @-mention.
    expect(await domain.claimEditWake('other-app', 'fresh')).toBe(true);
  });

  it('keeps an edit from waking the bot on a message that already engaged it', async () => {
    await domain.markEditWakeEngaged('app', ['answered', 'answered', 'merged']);

    expect(await domain.claimEditWake('app', 'answered')).toBe(false);
    expect(await domain.claimEditWake('app', 'merged')).toBe(false);
  });

  describe('conversation log', () => {
    const line = (n: number, extra: Record<string, unknown> = {}) => ({
      at: n * 1_000,
      authorId: `u${n % 3}`,
      authorName: `User ${n % 3}`,
      id: `m${n}`,
      isBot: false,
      text: `message ${n}`,
      ...extra,
    });

    it('returns the messages before the current one, oldest first', async () => {
      const key = 'discord:g:log1';
      await domain.rememberMessages([key], [line(3), line(1), line(2), line(4)]);

      const recent = await domain.readRecentMessages(key, 10, 'm4');

      expect(recent?.map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3']);
      expect(recent?.[0]).toMatchObject({ authorName: 'User 1', text: 'message 1' });
    });

    it('limits a read to the newest messages', async () => {
      const key = 'discord:g:log2';
      await domain.rememberMessages(
        [key],
        [1, 2, 3, 4, 5].map((n) => line(n)),
      );

      expect((await domain.readRecentMessages(key, 2))?.map((entry) => entry.id)).toEqual([
        'm4',
        'm5',
      ]);
    });

    it('keeps one copy of a message that two bots both saw', async () => {
      const key = 'discord:g:log3';
      await domain.rememberMessages([key], [line(1), line(2)]);
      await domain.rememberMessages([key], [line(2), line(3)]);

      expect((await domain.readRecentMessages(key, 10))?.map((entry) => entry.id)).toEqual([
        'm1',
        'm2',
        'm3',
      ]);
    });

    it('keeps the newest 200 messages of a channel and drops the rest', async () => {
      const key = 'discord:g:log4';
      await domain.rememberMessages(
        [key],
        Array.from({ length: 215 }, (_, i) => line(i + 1)),
      );

      const all = await domain.readRecentMessages(key, 500);

      expect(all).toHaveLength(200);
      expect(all?.[0].id).toBe('m16');
      expect(all?.at(-1)?.id).toBe('m215');
    });

    it('writes the same message under every key given, and lets the log expire', async () => {
      const keys = ['discord:g:log5', 'discord:g:log5:thread'];
      await domain.rememberMessages(keys, [line(1)]);

      for (const key of keys) {
        expect((await domain.readRecentMessages(key, 5))?.map((entry) => entry.id)).toEqual(['m1']);
      }
      const { default: IORedis } = await import('ioredis');
      const raw = new IORedis(url!);
      const ttl = await raw.ttl(`${prefix}:bot-wake:conversation_log:v1:${keys[0]}`);
      raw.disconnect();

      expect(ttl).toBeGreaterThan(0);
    });

    it('reads an unknown channel as empty and ignores a stored value that is not a message', async () => {
      expect(await domain.readRecentMessages('discord:g:nothing', 5)).toEqual([]);

      const { default: IORedis } = await import('ioredis');
      const raw = new IORedis(url!);
      await raw.zadd(`${prefix}:bot-wake:conversation_log:v1:discord:g:junk`, 1, 'not json');
      raw.disconnect();
      await domain.rememberMessages(['discord:g:junk'], [line(2)]);

      expect(
        (await domain.readRecentMessages('discord:g:junk', 5))?.map((entry) => entry.id),
      ).toEqual(['m2']);
    });
  });
});
