import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

export interface TelegramDraftSession {
  applicationId: string;
  draftId: number;
  operationId?: string;
  platformThreadId: string;
  savedAt?: number;
  stopRequested?: boolean;
  userId: string;
  workspaceId?: string;
}

const TTL_SECONDS = 30 * 60;
const memory = new Map<string, { expiresAt: number; session: TelegramDraftSession }>();
const stopRequests = new Map<string, number>();

const buildKey = (applicationId: string, platformThreadId: string, draftId: number): string =>
  `bot:telegram-draft:${applicationId}:${platformThreadId}:${draftId}`;
const buildStopKey = (key: string): string => `${key}:stop`;

const pruneExpiredMemory = (now: number): void => {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
  for (const [key, expiresAt] of stopRequests) {
    if (expiresAt <= now) stopRequests.delete(key);
  }
};

const readMemory = (key: string): TelegramDraftSession | undefined => {
  const now = Date.now();
  pruneExpiredMemory(now);
  return memory.get(key)?.session;
};

const writeMemory = (key: string, session: TelegramDraftSession): void => {
  const now = Date.now();
  pruneExpiredMemory(now);
  memory.set(key, { expiresAt: now + TTL_SECONDS * 1000, session });
};

export const saveTelegramDraftSession = async (session: TelegramDraftSession): Promise<void> => {
  const key = buildKey(session.applicationId, session.platformThreadId, session.draftId);
  const stamped = { ...session, savedAt: Date.now() };
  writeMemory(key, stamped);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(stamped), 'EX', TTL_SECONDS);
  } catch (error) {
    console.error(
      `[draftSession] failed to persist Telegram draft session (thread=${session.platformThreadId})`,
      error,
    );
  }
};

export const getTelegramDraftSession = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
): Promise<TelegramDraftSession | undefined> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const remote = JSON.parse(raw) as TelegramDraftSession;
        const local = readMemory(key);
        if (local && (local.savedAt ?? 0) > (remote.savedAt ?? 0)) return local;
        writeMemory(key, remote);
        return remote;
      }
    } catch (error) {
      console.error(
        `[draftSession] failed to read Telegram draft session (thread=${platformThreadId})`,
        error,
      );
    }
  }
  return readMemory(key);
};

export const setTelegramDraftOperation = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
  operationId: string,
): Promise<boolean> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  const session = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
  if (!session) return false;
  await saveTelegramDraftSession({ ...session, operationId });
  pruneExpiredMemory(Date.now());
  if (stopRequests.has(key)) return true;
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return session.stopRequested === true;
  try {
    return (await redis.get(buildStopKey(key))) === '1';
  } catch (error) {
    console.error(
      `[draftSession] failed to read Telegram draft stop marker (thread=${platformThreadId})`,
      error,
    );
    return session.stopRequested === true;
  }
};

export const requestTelegramDraftStop = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
): Promise<TelegramDraftSession | undefined> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  const session = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
  if (!session) return undefined;
  stopRequests.set(key, Date.now() + TTL_SECONDS * 1000);
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      await redis.set(buildStopKey(key), '1', 'EX', TTL_SECONDS);
    } catch (error) {
      console.error(
        `[draftSession] failed to persist Telegram draft stop marker (thread=${platformThreadId})`,
        error,
      );
    }
  }
  const updated = { ...session, stopRequested: true };
  await saveTelegramDraftSession(updated);
  return updated;
};

export const clearTelegramDraftSession = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
): Promise<void> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  memory.delete(key);
  stopRequests.delete(key);
  const redis = getAgentRuntimeRedisClient();
  if (!redis) return;
  try {
    await redis.del(key, buildStopKey(key));
  } catch (error) {
    console.error(
      `[draftSession] failed to clear Telegram draft session (thread=${platformThreadId})`,
      error,
    );
  }
};

export const resetTelegramDraftSessionsForTest = (): void => {
  memory.clear();
  stopRequests.clear();
};
