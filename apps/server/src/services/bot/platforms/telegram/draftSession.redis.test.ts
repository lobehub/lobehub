import { randomUUID } from 'node:crypto';

import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TelegramDraftSession } from './draftSession';
import {
  claimTelegramDraftCompletion,
  completeTelegramDraftSession,
  getTelegramDraftSession,
  requestTelegramDraftStop,
  resetTelegramDraftSessionsForTest,
  saveTelegramDraftSession,
  setTelegramDraftOperation,
  updateActiveTelegramDraftSession,
} from './draftSession';

const redisState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => redisState.client,
}));

const safeRedisUrl = (): string | undefined => {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  if (!process.env.REDIS_URL) return undefined;
  const hostname = new URL(process.env.REDIS_URL).hostname;
  return ['127.0.0.1', '::1', 'localhost'].includes(hostname) ? process.env.REDIS_URL : undefined;
};

const redisUrl = safeRedisUrl();
const describeWithRedis = redisUrl ? describe : describe.skip;
const keys = new Set<string>();
let redis: Redis;

const createScope = () => {
  const id = randomUUID();
  const applicationId = `draft-session-test-${id}`;
  const platformThreadId = `telegram:test-${id}`;
  const draftId = 1;
  const key = `bot:telegram-draft:${applicationId}:${platformThreadId}:${draftId}`;
  keys.add(key);
  return { applicationId, draftId, key, platformThreadId };
};

const createSession = ({
  applicationId,
  draftId,
  platformThreadId,
}: ReturnType<typeof createScope>): TelegramDraftSession => ({
  applicationId,
  content: 'Thinking…',
  draftId,
  platformThreadId,
  userId: 'draft-session-test-user',
});

const sessionArgs = ({
  applicationId,
  draftId,
  platformThreadId,
}: ReturnType<typeof createScope>) => [applicationId, platformThreadId, draftId] as const;

describeWithRedis('Telegram draft session Redis invariants', () => {
  beforeAll(async () => {
    redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    await redis.ping();
    redisState.client = redis;
  });

  beforeEach(() => resetTelegramDraftSessionsForTest());

  afterEach(async () => {
    resetTelegramDraftSessionsForTest();
    if (keys.size > 0) {
      await redis.del(...[...keys].flatMap((key) => [key, `${key}:stop`]));
      keys.clear();
    }
  });

  afterAll(async () => {
    redisState.client = null;
    await redis.quit();
  });

  it('does not allow an active lease to be preempted', async () => {
    const scope = createScope();
    await saveTelegramDraftSession(createSession(scope));

    await expect(claimTelegramDraftCompletion(...sessionArgs(scope))).resolves.toMatchObject({
      status: 'claimed',
    });
    await expect(claimTelegramDraftCompletion(...sessionArgs(scope))).resolves.toEqual({
      status: 'busy',
    });
  });

  it('reclaims a stale lease and prevents the old owner from finalizing', async () => {
    const scope = createScope();
    await saveTelegramDraftSession(createSession(scope));
    const first = await claimTelegramDraftCompletion(...sessionArgs(scope));
    if (first.status !== 'claimed') throw new Error('expected first lease claim');

    const stored = JSON.parse((await redis.get(scope.key))!) as TelegramDraftSession;
    await redis.set(scope.key, JSON.stringify({ ...stored, savedAt: Date.now() - 90_001 }));
    const reclaimed = await claimTelegramDraftCompletion(...sessionArgs(scope));
    expect(reclaimed).toMatchObject({ status: 'claimed' });
    if (reclaimed.status !== 'claimed') throw new Error('expected reclaimed lease');
    expect(reclaimed.owner).not.toBe(first.owner);

    await expect(completeTelegramDraftSession(...sessionArgs(scope), first.owner)).resolves.toBe(
      false,
    );
    await expect(redis.get(scope.key)).resolves.toContain(reclaimed.owner);
  });

  it('does not let a late active update overwrite completion', async () => {
    const scope = createScope();
    await saveTelegramDraftSession(createSession(scope));
    let enteredUpdate = false;
    let releaseUpdate!: () => void;
    const held = new Promise<void>((resolve) => (releaseUpdate = resolve));
    const update = updateActiveTelegramDraftSession(...sessionArgs(scope), async () => {
      enteredUpdate = true;
      await held;
      return 'Late update';
    });
    await vi.waitFor(() => expect(enteredUpdate).toBe(true));

    await completeTelegramDraftSession(...sessionArgs(scope));
    releaseUpdate();

    await expect(update).resolves.toBe(false);
    await expect(getTelegramDraftSession(...sessionArgs(scope))).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('monotonically preserves Stop and operation fields from stale writers', async () => {
    const scope = createScope();
    const initial = createSession(scope);
    await saveTelegramDraftSession(initial);
    await setTelegramDraftOperation(...sessionArgs(scope), 'operation-1');
    await requestTelegramDraftStop(...sessionArgs(scope));

    resetTelegramDraftSessionsForTest();
    await saveTelegramDraftSession({ ...initial, content: 'stale writer' });

    await expect(getTelegramDraftSession(...sessionArgs(scope))).resolves.toMatchObject({
      content: 'stale writer',
      operationId: 'operation-1',
      stopRequested: true,
    });
  });

  it('atomically coordinates concurrent Stop and operation registration', async () => {
    const scope = createScope();
    await saveTelegramDraftSession(createSession(scope));

    const [stopSession, operationSawStop] = await Promise.all([
      requestTelegramDraftStop(...sessionArgs(scope)),
      setTelegramDraftOperation(...sessionArgs(scope), 'operation-race'),
    ]);

    expect(operationSawStop || stopSession?.operationId === 'operation-race').toBe(true);
    await expect(getTelegramDraftSession(...sessionArgs(scope))).resolves.toMatchObject({
      operationId: 'operation-race',
      stopRequested: true,
    });
  });
});
