import { randomUUID } from 'node:crypto';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

export interface TelegramDraftSession {
  applicationId: string;
  content: string;
  delivered?: boolean;
  draftId: number;
  leaseOwner?: string;
  operationId?: string;
  platformThreadId: string;
  savedAt?: number;
  status?: TelegramDraftStatus;
  stopRequested?: boolean;
  userId: string;
  workspaceId?: string;
}

type TelegramDraftStatus = 'active' | 'completed' | 'delivering';

export type TelegramDraftClaim =
  | { owner: string; status: 'claimed' }
  | { status: 'busy' }
  | { status: 'completed' }
  | { status: 'finalize' }
  | { status: 'missing' };

const draftStatusRank = (status?: TelegramDraftStatus): number => {
  switch (status) {
    case 'completed': {
      return 2;
    }
    case 'delivering': {
      return 1;
    }
    default: {
      return 0;
    }
  }
};

const preferSession = (
  local?: TelegramDraftSession,
  remote?: TelegramDraftSession,
): TelegramDraftSession | undefined => {
  if (!local) return remote;
  if (!remote) return local;
  const localRank = draftStatusRank(local.status);
  const remoteRank = draftStatusRank(remote.status);
  if (remoteRank !== localRank) return remoteRank > localRank ? remote : local;
  return (local.savedAt ?? 0) > (remote.savedAt ?? 0) ? local : remote;
};

const isActiveSession = (session?: TelegramDraftSession): session is TelegramDraftSession =>
  Boolean(session && (!session.status || session.status === 'active'));

const completedSession = (
  session: TelegramDraftSession,
  savedAt = Date.now(),
): TelegramDraftSession => ({
  ...session,
  delivered: undefined,
  leaseOwner: undefined,
  savedAt,
  status: 'completed',
});

const TTL_SECONDS = 6 * 60 * 60;
/**
 * A `delivering` claim that is older than this can be reclaimed, but only
 * after the owner stops renewing. `handleCompletion` heartbeats during
 * long uploads and renews after each chunk; a lost renew aborts delivery,
 * and `complete` is a CAS on `leaseOwner` so a stolen worker cannot mark
 * the new owner's claim completed.
 */
const DELIVERING_LEASE_MS = 90 * 1000;
const memory = new Map<string, { expiresAt: number; session: TelegramDraftSession }>();
const stopRequests = new Map<string, number>();
const localLocks = new Map<string, Promise<void>>();

const CLAIM_COMPLETION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local session = cjson.decode(raw)
local status = session.status or 'active'
local savedAt = tonumber(session.savedAt) or 0
local now = tonumber(ARGV[1])
local leaseMs = tonumber(ARGV[2])
local owner = ARGV[3]
if status == 'completed' then return 2 end
if session.delivered then return 3 end
if status == 'delivering' and (now - savedAt) < leaseMs then return 0 end
session.status = 'delivering'
session.savedAt = now
session.leaseOwner = owner
session.delivered = nil
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[4])
return 1
`;
const RENEW_LEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local session = cjson.decode(raw)
if session.status ~= 'delivering' then return 0 end
if session.leaseOwner ~= ARGV[1] then return 0 end
session.savedAt = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
return 1
`;
const RELEASE_LEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local session = cjson.decode(raw)
if session.status ~= 'delivering' then return 0 end
if session.leaseOwner ~= ARGV[1] then return 0 end
session.status = 'active'
session.savedAt = tonumber(ARGV[2])
session.leaseOwner = nil
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
return 1
`;
const COMPLETE_LEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local session = cjson.decode(raw)
local owner = ARGV[1]
if session.status == 'completed' then return 1 end
if session.delivered then
  session.status = 'completed'
  session.savedAt = tonumber(ARGV[2])
  session.leaseOwner = nil
  session.delivered = nil
  redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
  return 1
end
if session.status == 'delivering' and session.leaseOwner and session.leaseOwner ~= owner then
  return 0
end
session.status = 'completed'
session.savedAt = tonumber(ARGV[2])
session.leaseOwner = nil
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
return 1
`;
const MARK_DELIVERED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local session = cjson.decode(raw)
if session.status ~= 'delivering' then return 0 end
if session.leaseOwner ~= ARGV[1] then return 0 end
session.delivered = true
session.savedAt = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[3])
return 1
`;
const SAVE_IF_ALLOWED_SCRIPT = `
local function rank(status)
  if status == 'completed' then return 2 end
  if status == 'delivering' then return 1 end
  return 0
end
local incoming = cjson.decode(ARGV[1])
local raw = redis.call('GET', KEYS[1])
if raw then
  local current = cjson.decode(raw)
  local currentRank = rank(current.status or 'active')
  local incomingRank = rank(incoming.status or 'active')
  if currentRank > incomingRank then
    return 0
  end
  if currentRank == incomingRank then
    if current.stopRequested then incoming.stopRequested = true end
    if current.operationId and not incoming.operationId then
      incoming.operationId = current.operationId
    end
  end
end
local encoded = cjson.encode(incoming)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[2])
return encoded
`;
const SET_OPERATION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local session = cjson.decode(raw)
local status = session.status or 'active'
if status ~= 'active' then return nil end
session.operationId = ARGV[1]
if session.stopRequested or redis.call('GET', KEYS[2]) == '1' then
  session.stopRequested = true
end
session.savedAt = tonumber(ARGV[2])
local encoded = cjson.encode(session)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[3])
return encoded
`;
const REQUEST_STOP_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local session = cjson.decode(raw)
local status = session.status or 'active'
if status ~= 'active' then return nil end
session.stopRequested = true
session.savedAt = tonumber(ARGV[1])
local encoded = cjson.encode(session)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[2])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
return encoded
`;

const buildKey = (applicationId: string, platformThreadId: string, draftId: number): string =>
  `bot:telegram-draft:${applicationId}:${platformThreadId}:${draftId}`;
const buildStopKey = (key: string): string => `${key}:stop`;

const withLocalLock = async <T>(key: string, action: () => Promise<T>): Promise<T> => {
  const previous = localLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  localLocks.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (localLocks.get(key) === tail) localLocks.delete(key);
  }
};

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

export const saveTelegramDraftSession = async (
  session: TelegramDraftSession,
  durable = false,
): Promise<boolean> => {
  const key = buildKey(session.applicationId, session.platformThreadId, session.draftId);
  const stamped = { ...session, savedAt: Date.now(), status: session.status ?? 'active' } as const;
  const existing = readMemory(key);
  if (!durable && draftStatusRank(existing?.status) > draftStatusRank(stamped.status)) return true;

  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    try {
      const saved = await redis.eval(
        SAVE_IF_ALLOWED_SCRIPT,
        1,
        key,
        JSON.stringify(stamped),
        TTL_SECONDS,
      );
      if (saved === 0) return true;
      if (typeof saved === 'string') {
        writeMemory(key, JSON.parse(saved) as TelegramDraftSession);
        return true;
      }
    } catch (error) {
      console.error(
        `[draftSession] failed to persist Telegram draft session (thread=${session.platformThreadId})`,
        error,
      );
      if (durable) return false;
    }
  }

  if (durable) return false;
  writeMemory(key, stamped);
  return true;
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
        const selected = preferSession(readMemory(key), remote);
        if (!selected) return undefined;
        writeMemory(key, selected);
        return selected;
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
  return withLocalLock(key, async () => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      try {
        const saved = await redis.eval(
          SET_OPERATION_SCRIPT,
          2,
          key,
          buildStopKey(key),
          operationId,
          Date.now(),
          TTL_SECONDS,
        );
        if (typeof saved === 'string') {
          const session = JSON.parse(saved) as TelegramDraftSession;
          writeMemory(key, session);
          return Boolean(session.stopRequested);
        }
        return false;
      } catch (error) {
        console.error(
          `[draftSession] failed to register Telegram draft operation (thread=${platformThreadId})`,
          error,
        );
      }
    }
    const session = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
    if (!isActiveSession(session)) return false;
    await saveTelegramDraftSession({ ...session, operationId });
    if (stopRequests.has(key) || session.stopRequested) return true;
    return false;
  });
};

export const requestTelegramDraftStop = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
): Promise<TelegramDraftSession | undefined> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  return withLocalLock(key, async () => {
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      try {
        const saved = await redis.eval(
          REQUEST_STOP_SCRIPT,
          2,
          key,
          buildStopKey(key),
          Date.now(),
          TTL_SECONDS,
        );
        if (typeof saved === 'string') {
          const session = JSON.parse(saved) as TelegramDraftSession;
          writeMemory(key, session);
          stopRequests.set(key, Date.now() + TTL_SECONDS * 1000);
          return session;
        }
        return undefined;
      } catch (error) {
        console.error(
          `[draftSession] failed to persist Telegram draft stop (thread=${platformThreadId})`,
          error,
        );
      }
    }
    const session = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
    if (!isActiveSession(session)) return undefined;
    stopRequests.set(key, Date.now() + TTL_SECONDS * 1000);
    const updated = { ...session, stopRequested: true };
    await saveTelegramDraftSession(updated);
    return updated;
  });
};

export const updateActiveTelegramDraftSession = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
  update: (session: TelegramDraftSession) => Promise<string | undefined>,
): Promise<boolean> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  const session = await withLocalLock(key, async () => {
    const current = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
    if (!isActiveSession(current) || current.stopRequested) {
      return undefined;
    }
    return current;
  });
  if (!session) return false;

  // Release the session lock for the Telegram round-trip so Stop/claim from
  // another worker can proceed. Re-check status before persisting content.
  const content = await update(session);

  return withLocalLock(key, async () => {
    const latest = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
    if (!isActiveSession(latest) || latest.stopRequested) {
      return false;
    }
    await saveTelegramDraftSession({ ...latest, content: content ?? latest.content });
    return true;
  });
};

const finishCompletedSession = async (
  key: string,
  platformThreadId: string,
  session: TelegramDraftSession,
  now: number,
  redis: ReturnType<typeof getAgentRuntimeRedisClient>,
): Promise<void> => {
  writeMemory(key, completedSession(session, now));
  stopRequests.delete(key);
  if (!redis) return;
  try {
    await redis.del(buildStopKey(key));
  } catch (error) {
    console.error(
      `[draftSession] failed to clear Telegram draft stop marker (thread=${platformThreadId})`,
      error,
    );
  }
};

export const completeTelegramDraftSession = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
  leaseOwner?: string,
): Promise<boolean> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  return withLocalLock(key, async () => {
    const owner = leaseOwner ?? '';
    const now = Date.now();
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      const result = await redis.eval(COMPLETE_LEASE_SCRIPT, 1, key, owner, now, TTL_SECONDS);
      if (result !== -1) {
        if (result !== 1) return false;
        const local = readMemory(key);
        if (local) {
          await finishCompletedSession(key, platformThreadId, local, now, redis);
        } else {
          stopRequests.delete(key);
        }
        return true;
      }
    }

    const session = await getTelegramDraftSession(applicationId, platformThreadId, draftId);
    if (!session) return false;
    if (session.status === 'completed') return true;
    if (session.delivered) {
      await saveTelegramDraftSession(completedSession(session));
      stopRequests.delete(key);
      return true;
    }
    if (owner && session.status === 'delivering' && session.leaseOwner !== owner) return false;
    if (!owner && session.status === 'delivering' && session.leaseOwner) return false;
    await saveTelegramDraftSession(completedSession(session));
    stopRequests.delete(key);
    return true;
  });
};

export const markTelegramDraftDelivered = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
  leaseOwner: string,
): Promise<boolean> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  return withLocalLock(key, async () => {
    const now = Date.now();
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      const result = await redis.eval(MARK_DELIVERED_SCRIPT, 1, key, leaseOwner, now, TTL_SECONDS);
      if (result !== -1) {
        if (result !== 1) return false;
        const local = readMemory(key);
        if (local) writeMemory(key, { ...local, delivered: true, savedAt: now });
        return true;
      }
    }

    const session = readMemory(key);
    if (!session || session.status !== 'delivering' || session.leaseOwner !== leaseOwner) {
      return false;
    }
    writeMemory(key, { ...session, delivered: true, savedAt: now });
    return true;
  });
};

const isStaleDeliveringSession = (session: TelegramDraftSession, now: number): boolean =>
  session.status === 'delivering' && now - (session.savedAt ?? 0) >= DELIVERING_LEASE_MS;

const decodeClaimResult = (result: unknown, owner: string): TelegramDraftClaim | undefined => {
  if (result === 1) return { owner, status: 'claimed' };
  if (result === 2) return { status: 'completed' };
  if (result === 3) return { status: 'finalize' };
  if (result === 0) return { status: 'busy' };
  return undefined;
};

export const claimTelegramDraftCompletion = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
): Promise<TelegramDraftClaim> => {
  const key = buildKey(applicationId, platformThreadId, draftId);
  return withLocalLock(key, async () => {
    const now = Date.now();
    const owner = randomUUID();
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      const result = await redis.eval(
        CLAIM_COMPLETION_SCRIPT,
        1,
        key,
        now,
        DELIVERING_LEASE_MS,
        owner,
        TTL_SECONDS,
      );
      if (result !== -1) {
        const decoded = decodeClaimResult(result, owner);
        if (decoded?.status === 'claimed') {
          const local = readMemory(key);
          if (local) {
            writeMemory(key, {
              ...local,
              delivered: undefined,
              leaseOwner: owner,
              savedAt: now,
              status: 'delivering',
            });
          }
        }
        return decoded ?? { status: 'busy' };
      }
    }

    const session = readMemory(key);
    if (!session) return { status: 'missing' };
    if (session.status === 'completed') return { status: 'completed' };
    if (session.delivered) return { status: 'finalize' };
    if (session.status === 'delivering' && !isStaleDeliveringSession(session, now)) {
      return { status: 'busy' };
    }
    writeMemory(key, {
      ...session,
      delivered: undefined,
      leaseOwner: owner,
      savedAt: now,
      status: 'delivering',
    });
    return { owner, status: 'claimed' };
  });
};

export const renewTelegramDraftCompletion = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
  owner: string,
): Promise<boolean> => {
  if (!owner) return false;
  const key = buildKey(applicationId, platformThreadId, draftId);
  return withLocalLock(key, async () => {
    const now = Date.now();
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      const result = await redis.eval(RENEW_LEASE_SCRIPT, 1, key, owner, now, TTL_SECONDS);
      if (result !== -1) {
        if (result === 1) {
          const local = readMemory(key);
          if (local) writeMemory(key, { ...local, savedAt: now });
          return true;
        }
        return false;
      }
    }

    const session = readMemory(key);
    if (!session || session.status !== 'delivering' || session.leaseOwner !== owner) return false;
    writeMemory(key, { ...session, savedAt: now });
    return true;
  });
};

export const releaseTelegramDraftCompletion = async (
  applicationId: string,
  platformThreadId: string,
  draftId: number,
  owner: string,
): Promise<void> => {
  if (!owner) return;
  const key = buildKey(applicationId, platformThreadId, draftId);
  await withLocalLock(key, async () => {
    const now = Date.now();
    const redis = getAgentRuntimeRedisClient();
    if (redis) {
      const result = await redis.eval(RELEASE_LEASE_SCRIPT, 1, key, owner, now, TTL_SECONDS);
      if (result !== -1) {
        if (result === 1) {
          const local = readMemory(key);
          if (local) {
            writeMemory(key, { ...local, leaseOwner: undefined, savedAt: now, status: 'active' });
          }
        }
        return;
      }
    }

    const session = readMemory(key);
    if (session?.status === 'delivering' && session.leaseOwner === owner) {
      writeMemory(key, { ...session, leaseOwner: undefined, savedAt: now, status: 'active' });
    }
  });
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
  localLocks.clear();
};
