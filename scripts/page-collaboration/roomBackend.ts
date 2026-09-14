import { createHash, randomUUID } from 'node:crypto';

import Redis from 'ioredis';

export interface CollaborationRoomScope {
  documentId: string;
  roomId: string;
  userId?: string | null;
  workspaceId?: string | null;
}

export type CollaborationRoomClientKind = 'agent' | 'browser';

export interface CollaborationRoomPresenceInput {
  clientId: string;
  clientKind: CollaborationRoomClientKind;
  expiresAt: number | null;
  maxClients: number;
}

export type CollaborationRoomPresenceReservation =
  { accepted: true } | { accepted: false; reason: 'full' };

export interface CollaborationRoomSnapshot {
  /** True only after the owner-fenced bootstrap migration has been persisted. */
  bootstrapReady?: boolean;
  revision: number;
  stateVector: Uint8Array;
  update: Uint8Array;
}

export type CollaborationRoomBackendEnvelope =
  | {
      bootstrapReady: true;
      kind: 'bootstrap';
      messageId: string;
      origin: string;
      principal?: Record<string, unknown> | null;
      revision: number;
      sequence: number;
      sender: number;
      stateVector: string;
      update: string;
    }
  | {
      kind: 'update';
      messageId: string;
      origin: string;
      principal?: Record<string, unknown> | null;
      revision: number;
      sequence: number;
      sender: number;
      update: string;
    }
  | {
      awareness: {
        clientId: number;
        sequence: number;
        state: Record<string, unknown> | null;
      };
      kind: 'awareness';
      origin: string;
      sequence: number;
    };

export interface CollaborationRoomBackendRoomState {
  bootstrapReady?: boolean;
  ownerId: string;
  revision: number;
  snapshot: CollaborationRoomSnapshot | null;
  snapshotSource?: 'backend' | 'loader';
}

export interface CollaborationRoomBackend {
  allocateRevision: (scope: CollaborationRoomScope) => Promise<number>;
  close: () => Promise<void>;
  readonly durable: boolean;
  ensureRoom: (scope: CollaborationRoomScope) => Promise<CollaborationRoomBackendRoomState>;
  readonly healthy: () => boolean;
  initialize: () => Promise<void>;
  readonly instanceId: string;
  isOwner: (scope: CollaborationRoomScope) => Promise<boolean>;
  readonly leaseRenewalMs: number;
  readonly mode: 'memory' | 'redis';
  observeRevision: (scope: CollaborationRoomScope, revision: number) => Promise<void>;
  publish: (
    scope: CollaborationRoomScope,
    envelope: CollaborationRoomBackendEnvelope,
  ) => Promise<void>;
  /** Release a presence reservation when its socket closes. */
  releaseClient?: (
    scope: CollaborationRoomScope,
    input: Pick<CollaborationRoomPresenceInput, 'clientId' | 'clientKind'>,
  ) => Promise<void>;
  releaseOwner: (scope: CollaborationRoomScope) => Promise<void>;
  renewOwner: (scope: CollaborationRoomScope) => Promise<boolean>;
  readonly requireScope: boolean;
  /** Optional cross-instance room presence reservation. */
  reserveClient?: (
    scope: CollaborationRoomScope,
    input: CollaborationRoomPresenceInput,
  ) => Promise<CollaborationRoomPresenceReservation>;
  reserveReplay: (
    replayKey: string,
    expiresAt: number | null,
  ) => Promise<CollaborationReplayReservation>;
  saveSnapshot: (
    scope: CollaborationRoomScope,
    snapshot: CollaborationRoomSnapshot,
  ) => Promise<boolean>;
  subscribe: (
    scope: CollaborationRoomScope,
    listener: (envelope: CollaborationRoomBackendEnvelope) => void,
  ) => Promise<() => Promise<void>>;
}

export type CollaborationReplayReservation =
  { accepted: true } | { accepted: false; reason: 'full' | 'replayed' };

export interface CollaborationRoomSnapshotLoaderInput {
  scope: CollaborationRoomScope;
}

export type CollaborationRoomSnapshotLoader = (
  input: CollaborationRoomSnapshotLoaderInput,
) => Promise<CollaborationRoomSnapshot | null>;

export interface MemoryRoomBackendStore {
  presence?: Map<
    string,
    Map<string, { clientKind: CollaborationRoomClientKind; expiresAt: number }>
  >;
  replay: Map<string, number>;
  rooms: Map<
    string,
    {
      listeners: Set<(envelope: CollaborationRoomBackendEnvelope) => void>;
      ownerId: string | null;
      ownerToken: string | null;
      ownerExpiresAt: number;
      revision: number;
      snapshot: CollaborationRoomSnapshot | null;
      snapshotSource?: 'backend' | 'loader';
      snapshotLoaderPromise?: Promise<CollaborationRoomSnapshot | null>;
    }
  >;
}

const DEFAULT_LEASE_MS = 15_000;
const DEFAULT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_REPLAY_ENTRIES = 10_000;

const cloneBytes = (value: Uint8Array): Uint8Array => new Uint8Array(value);

const cloneSnapshot = (
  snapshot: CollaborationRoomSnapshot | null,
): CollaborationRoomSnapshot | null =>
  snapshot
    ? {
        ...(snapshot.bootstrapReady === undefined
          ? {}
          : { bootstrapReady: snapshot.bootstrapReady }),
        revision: snapshot.revision,
        stateVector: cloneBytes(snapshot.stateVector),
        update: cloneBytes(snapshot.update),
      }
    : null;

const scopeKey = (scope: CollaborationRoomScope, requireScope: boolean): string => {
  if (scope.roomId !== scope.documentId) {
    throw new Error('Collaboration room and document identifiers must match.');
  }
  if (requireScope && (!scope.userId || typeof scope.userId !== 'string')) {
    throw new Error('Collaboration room backend requires an authenticated user scope.');
  }

  return createHash('sha256')
    .update(
      JSON.stringify({
        documentId: scope.documentId,
        roomId: scope.roomId,
        // Workspace documents are shared by all authorized members. A
        // private room has no workspace and therefore keeps the user scope.
        userId: scope.workspaceId ? null : (scope.userId ?? null),
        workspaceId: scope.workspaceId ?? null,
      }),
    )
    .digest('hex');
};

const expiresIn = (expiresAt: number | null, fallback = DEFAULT_LEASE_MS): number => {
  if (expiresAt === null || !Number.isFinite(expiresAt)) return fallback;
  return Math.max(1, Math.ceil(expiresAt - Date.now()));
};

const normalizePresenceMaxClients = (value: number): number =>
  Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1;

const assertEnvelope = (value: unknown): CollaborationRoomBackendEnvelope => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid collaboration backend envelope.');
  }
  const envelope = value as Record<string, unknown>;
  const sequence = envelope.sequence;
  if (
    (envelope.kind !== 'update' &&
      envelope.kind !== 'awareness' &&
      envelope.kind !== 'bootstrap') ||
    typeof envelope.origin !== 'string' ||
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  ) {
    throw new Error('Invalid collaboration backend envelope.');
  }

  if (envelope.kind === 'update' || envelope.kind === 'bootstrap') {
    if (
      typeof envelope.messageId !== 'string' ||
      typeof envelope.update !== 'string' ||
      !Number.isSafeInteger(envelope.revision) ||
      !Number.isSafeInteger(envelope.sender)
    ) {
      throw new Error(
        envelope.kind === 'bootstrap'
          ? 'Invalid collaboration backend bootstrap envelope.'
          : 'Invalid collaboration backend update envelope.',
      );
    }
    if (
      envelope.kind === 'bootstrap' &&
      (envelope.bootstrapReady !== true || typeof envelope.stateVector !== 'string')
    ) {
      throw new Error('Invalid collaboration backend bootstrap envelope.');
    }
  } else {
    const awareness = envelope.awareness;
    if (
      !awareness ||
      typeof awareness !== 'object' ||
      !Number.isSafeInteger((awareness as Record<string, unknown>).clientId) ||
      !Number.isSafeInteger((awareness as Record<string, unknown>).sequence)
    ) {
      throw new Error('Invalid collaboration backend awareness envelope.');
    }
  }

  return envelope as CollaborationRoomBackendEnvelope;
};

const createEmptyMemoryStore = (): MemoryRoomBackendStore => ({
  presence: new Map(),
  replay: new Map(),
  rooms: new Map(),
});

const createMemoryRoomBackend = (
  options: {
    instanceId?: string;
    leaseMs?: number;
    requireScope?: boolean;
    snapshotLoader?: CollaborationRoomSnapshotLoader;
    store?: MemoryRoomBackendStore;
    maxReplayEntries?: number;
  } = {},
): CollaborationRoomBackend => {
  const instanceId = options.instanceId ?? `memory-${randomUUID()}`;
  const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const requireScope = options.requireScope ?? false;
  const store = options.store ?? createEmptyMemoryStore();
  const maxReplayEntries = Math.max(1, options.maxReplayEntries ?? DEFAULT_MAX_REPLAY_ENTRIES);
  const getPresence = (scope: CollaborationRoomScope) => {
    store.presence ??= new Map();
    const key = scopeKey(scope, requireScope);
    let entries = store.presence.get(key);
    if (!entries) {
      entries = new Map();
      store.presence.set(key, entries);
    }
    return entries;
  };
  const getState = (scope: CollaborationRoomScope) => {
    const key = scopeKey(scope, requireScope);
    let state = store.rooms.get(key);
    if (!state) {
      state = {
        listeners: new Set(),
        ownerExpiresAt: 0,
        ownerId: null,
        ownerToken: null,
        revision: 0,
        snapshot: null,
        snapshotSource: undefined,
      };
      store.rooms.set(key, state);
    }
    return state;
  };

  const ensureRoom = async (scope: CollaborationRoomScope) => {
    const state = getState(scope);
    const now = Date.now();
    if (!state.ownerId || state.ownerExpiresAt <= now || state.ownerId === instanceId) {
      state.ownerId = instanceId;
      state.ownerToken ??= randomUUID();
      state.ownerExpiresAt = now + leaseMs;
    }

    if (!state.snapshot && options.snapshotLoader) {
      state.snapshotLoaderPromise ??= options.snapshotLoader({ scope }).finally(() => {
        state!.snapshotLoaderPromise = undefined;
      });
      const loaded = await state.snapshotLoaderPromise;
      if (loaded && !state.snapshot) {
        state.snapshot = cloneSnapshot(loaded);
        state.snapshotSource = 'loader';
        state.revision = Math.max(state.revision, loaded.revision);
      }
    }

    return {
      ...(state.snapshot?.bootstrapReady === undefined
        ? {}
        : { bootstrapReady: state.snapshot.bootstrapReady }),
      ownerId: state.ownerId,
      revision: state.revision,
      snapshot: cloneSnapshot(state.snapshot),
      snapshotSource: state.snapshotSource,
    };
  };

  return {
    durable: false,
    instanceId,
    leaseRenewalMs: Math.max(500, Math.floor(leaseMs / 3)),
    mode: 'memory',
    requireScope,
    healthy: () => true,
    initialize: async () => undefined,
    close: async () => undefined,
    ensureRoom,
    isOwner: async (scope) => {
      const state = getState(scope);
      return state.ownerId === instanceId && state.ownerExpiresAt > Date.now();
    },
    renewOwner: async (scope) => {
      const state = getState(scope);
      if (state.ownerId !== instanceId || state.ownerExpiresAt <= Date.now()) return false;
      state.ownerExpiresAt = Date.now() + leaseMs;
      return true;
    },
    releaseOwner: async (scope) => {
      const state = getState(scope);
      if (state.ownerId !== instanceId) return;
      state.ownerId = null;
      state.ownerToken = null;
      state.ownerExpiresAt = 0;
    },
    allocateRevision: async (scope) => {
      const state = getState(scope);
      state.revision += 1;
      return state.revision;
    },
    observeRevision: async (scope, revision) => {
      const state = getState(scope);
      state.revision = Math.max(state.revision, revision);
    },
    publish: async (scope, envelope) => {
      const state = getState(scope);
      const parsed = assertEnvelope(envelope);
      state.listeners.forEach((listener) => listener(parsed));
    },
    reserveClient: async (scope, input) => {
      const entries = getPresence(scope);
      const now = Date.now();
      for (const [clientId, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(clientId);
      }
      const existing = entries.get(input.clientId);
      if (existing) return { accepted: true };
      const maxClients = normalizePresenceMaxClients(input.maxClients);
      const count = [...entries.values()].filter(
        (entry) => entry.clientKind === input.clientKind,
      ).length;
      if (count >= maxClients) return { accepted: false, reason: 'full' };
      entries.set(input.clientId, {
        clientKind: input.clientKind,
        expiresAt: input.expiresAt ?? now + leaseMs,
      });
      return { accepted: true };
    },
    releaseClient: async (scope, input) => {
      const entries = getPresence(scope);
      entries.delete(input.clientId);
      if (entries.size === 0) {
        store.presence?.delete(scopeKey(scope, requireScope));
      }
    },
    subscribe: async (scope, listener) => {
      const state = getState(scope);
      state.listeners.add(listener);
      return async () => {
        state.listeners.delete(listener);
      };
    },
    reserveReplay: async (replayKey, expiresAt) => {
      const now = Date.now();
      for (const [key, expiry] of store.replay) {
        if (expiry <= now) store.replay.delete(key);
      }
      const existing = store.replay.get(replayKey);
      if (existing && existing > now) return { accepted: false, reason: 'replayed' };
      if (!existing && store.replay.size >= maxReplayEntries) {
        return { accepted: false, reason: 'full' };
      }
      store.replay.set(replayKey, expiresAt ?? now + DEFAULT_LEASE_MS);
      return { accepted: true };
    },
    saveSnapshot: async (scope, snapshot) => {
      const state = getState(scope);
      if (state.ownerId !== instanceId || state.ownerExpiresAt <= Date.now()) return false;
      state.snapshot = cloneSnapshot(snapshot);
      state.snapshotSource = 'backend';
      state.revision = Math.max(state.revision, snapshot.revision);
      return true;
    },
  };
};

export interface RedisRoomBackendOptions {
  commandTimeoutMs?: number;
  database?: number;
  instanceId?: string;
  leaseMs?: number;
  maxReplayEntries?: number;
  password?: string;
  prefix?: string;
  redisUrl: string;
  requireScope?: boolean;
  snapshotLoader?: CollaborationRoomSnapshotLoader;
  snapshotTtlMs?: number;
  tls?: boolean;
  username?: string;
}

const redisOwnerRenewScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`;
const redisOwnerReleaseScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;
const redisSaveSnapshotScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`;
const redisReserveReplayScript = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local expiresAt = tonumber(ARGV[3])
local maxEntries = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZSCORE', KEYS[1], member) then return -1 end
if redis.call('ZCARD', KEYS[1]) >= maxEntries then return 0 end
redis.call('ZADD', KEYS[1], expiresAt, member)
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], math.max(1, tonumber(latest[2]) - now))
return 1
`;
const redisReservePresenceScript = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local expiresAt = tonumber(ARGV[3])
local maxClients = tonumber(ARGV[4])
local clientKind = ARGV[5]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZSCORE', KEYS[1], member) then return 1 end
local prefix = clientKind .. ':'
local count = 0
for _, candidate in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  if string.sub(candidate, 1, string.len(prefix)) == prefix then count = count + 1 end
end
if count >= maxClients then return 0 end
redis.call('ZADD', KEYS[1], expiresAt, member)
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], math.max(1, tonumber(latest[2]) - now))
return 1
`;
const redisReleasePresenceScript = `
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end
return 1
`;
const redisObserveRevisionScript = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local next = tonumber(ARGV[1])
if next > current then
  redis.call('SET', KEYS[1], ARGV[1])
end
return math.max(current, next)
`;

const createRedisRoomBackend = (options: RedisRoomBackendOptions): CollaborationRoomBackend => {
  const instanceId = options.instanceId ?? `redis-${randomUUID()}`;
  const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const snapshotTtlMs = Math.max(1_000, options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS);
  const requireScope = options.requireScope ?? true;
  const prefix = (options.prefix || 'lobechat').replace(/:+$/, '');
  const commandTimeout = Math.max(500, options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
  const maxReplayEntries = Math.max(1, options.maxReplayEntries ?? DEFAULT_MAX_REPLAY_ENTRIES);
  let client: Redis | null = null;
  let subscriber: Redis | null = null;
  let available = false;
  let commandReady = false;
  let subscriberReady = false;
  const ownerTokens = new Map<string, string>();
  const subscriptions = new Map<
    string,
    Set<(envelope: CollaborationRoomBackendEnvelope) => void>
  >();

  const roomDigest = (scope: CollaborationRoomScope) => scopeKey(scope, requireScope);
  const ownerKey = (scope: CollaborationRoomScope) =>
    `${prefix}:page-collaboration:owner:${roomDigest(scope)}`;
  const revisionKey = (scope: CollaborationRoomScope) =>
    `${prefix}:page-collaboration:revision:${roomDigest(scope)}`;
  const snapshotKey = (scope: CollaborationRoomScope) =>
    `${prefix}:page-collaboration:snapshot:${roomDigest(scope)}`;
  const presenceKey = (scope: CollaborationRoomScope) =>
    `${prefix}:page-collaboration:presence:${roomDigest(scope)}`;
  const channelKey = (scope: CollaborationRoomScope) =>
    `${prefix}:page-collaboration:room:${roomDigest(scope)}`;
  const sharedReplayKey = `${prefix}:page-collaboration:replay`;
  const refreshAvailable = () => {
    available =
      commandReady &&
      subscriberReady &&
      client?.status === 'ready' &&
      subscriber?.status === 'ready';
    return available;
  };
  const assertAvailable = () => {
    refreshAvailable();
    if (!available || !client || !subscriber) {
      throw new Error('Page collaboration Redis backend is unavailable.');
    }
    return { client, subscriber };
  };

  const parseSnapshot = (value: string | null): CollaborationRoomSnapshot | null => {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (
        typeof parsed.revision !== 'number' ||
        !Number.isSafeInteger(parsed.revision) ||
        typeof parsed.stateVector !== 'string' ||
        typeof parsed.update !== 'string'
      ) {
        return null;
      }
      return {
        ...(typeof parsed.bootstrapReady === 'boolean'
          ? { bootstrapReady: parsed.bootstrapReady }
          : {}),
        revision: parsed.revision,
        stateVector: new Uint8Array(Buffer.from(parsed.stateVector, 'base64')),
        update: new Uint8Array(Buffer.from(parsed.update, 'base64')),
      };
    } catch {
      return null;
    }
  };

  const getOwner = async (scope: CollaborationRoomScope): Promise<string | null> => {
    const { client: redis } = assertAvailable();
    const value = await redis.get(ownerKey(scope));
    if (!value) return null;
    return value.split('|', 1)[0] || null;
  };

  const ensureRoom = async (scope: CollaborationRoomScope) => {
    const { client: redis } = assertAvailable();
    const digest = roomDigest(scope);
    const key = ownerKey(scope);
    let token = ownerTokens.get(digest);
    if (!token) {
      token = `${instanceId}|${randomUUID()}`;
      ownerTokens.set(digest, token);
    }
    const claimed = await redis.set(key, token, 'PX', leaseMs, 'NX');
    if (claimed === 'OK') {
      // The first owner also becomes the durable revision allocator. Existing
      // revisions are read below, so a restart never returns to revision 1.
    } else {
      const current = await redis.get(key);
      if (current === token) await redis.pexpire(key, leaseMs);
    }

    let snapshotSource: CollaborationRoomBackendRoomState['snapshotSource'] = undefined;
    let snapshot = parseSnapshot(await redis.get(snapshotKey(scope)));
    if (snapshot) snapshotSource = 'backend';
    if (!snapshot && options.snapshotLoader) {
      const loaded = await options.snapshotLoader({ scope });
      if (loaded) {
        snapshot = cloneSnapshot(loaded);
        snapshotSource = 'loader';
        // Do not overwrite a snapshot another instance won while the DB read
        // was in flight. SET NX is intentionally used only for bootstrap.
        await redis.set(
          snapshotKey(scope),
          JSON.stringify({
            ...(loaded.bootstrapReady === undefined
              ? {}
              : { bootstrapReady: loaded.bootstrapReady }),
            revision: loaded.revision,
            stateVector: Buffer.from(loaded.stateVector).toString('base64'),
            update: Buffer.from(loaded.update).toString('base64'),
          }),
          'PX',
          snapshotTtlMs,
          'NX',
        );
        const sharedSnapshot = parseSnapshot(await redis.get(snapshotKey(scope)));
        if (sharedSnapshot) {
          snapshot = sharedSnapshot;
          snapshotSource = 'backend';
        }
      }
    }

    if (snapshot) {
      await redis.set(revisionKey(scope), String(snapshot.revision), 'NX');
    }

    let owner = await getOwner(scope);
    if (!owner) {
      // A slow DB bootstrap can outlive the first lease. Re-claim only when
      // the key is still free; never report ourselves as owner on a stale read.
      await redis.set(key, token, 'PX', leaseMs, 'NX');
      owner = await getOwner(scope);
    }
    const revision = await redis.get(revisionKey(scope));
    return {
      ...(snapshot?.bootstrapReady === undefined
        ? {}
        : { bootstrapReady: snapshot.bootstrapReady }),
      ownerId: owner || 'unowned',
      revision: Math.max(Number.parseInt(revision || '0', 10) || 0, snapshot?.revision || 0),
      snapshot,
      snapshotSource,
    };
  };

  const connect = async (redis: Redis) => {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
  };

  return {
    durable: true,
    instanceId,
    leaseRenewalMs: Math.max(500, Math.floor(leaseMs / 3)),
    mode: 'redis',
    requireScope,
    healthy: refreshAvailable,
    initialize: async () => {
      if (available) return;
      if (!options.redisUrl.trim())
        throw new Error('Redis URL is required for page collaboration.');
      const common = {
        commandTimeout,
        connectTimeout: commandTimeout,
        db: options.database,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        password: options.password,
        tls: options.tls ? {} : undefined,
        username: options.username,
      };
      const command = new Redis(options.redisUrl, common);
      const pubsub = command.duplicate();
      const markCommandUnavailable = () => {
        commandReady = false;
        refreshAvailable();
      };
      const markSubscriberUnavailable = () => {
        subscriberReady = false;
        refreshAvailable();
      };
      command.on('error', markCommandUnavailable);
      command.on('close', markCommandUnavailable);
      command.on('end', markCommandUnavailable);
      pubsub.on('error', markSubscriberUnavailable);
      pubsub.on('close', markSubscriberUnavailable);
      pubsub.on('end', markSubscriberUnavailable);
      command.on('ready', () => {
        commandReady = true;
        refreshAvailable();
      });
      pubsub.on('ready', () => {
        subscriberReady = true;
        refreshAvailable();
      });
      try {
        await connect(command);
        await connect(pubsub);
      } catch (error) {
        commandReady = false;
        subscriberReady = false;
        available = false;
        await Promise.allSettled([command.quit(), pubsub.quit()]);
        throw error;
      }
      client = command;
      subscriber = pubsub;
      pubsub.on('message', (channel, payload) => {
        const listeners = subscriptions.get(channel);
        if (!listeners) return;
        let envelope: CollaborationRoomBackendEnvelope;
        try {
          envelope = assertEnvelope(JSON.parse(payload));
        } catch {
          return;
        }
        listeners.forEach((listener) => listener(envelope));
      });
      commandReady = command.status === 'ready';
      subscriberReady = pubsub.status === 'ready';
      refreshAvailable();
    },
    close: async () => {
      commandReady = false;
      subscriberReady = false;
      available = false;
      subscriptions.clear();
      ownerTokens.clear();
      const currentClient = client;
      const currentSubscriber = subscriber;
      client = null;
      subscriber = null;
      await Promise.allSettled([currentClient?.quit(), currentSubscriber?.quit()]);
    },
    ensureRoom,
    isOwner: async (scope) => {
      const digest = roomDigest(scope);
      const token = ownerTokens.get(digest);
      if (!token) return false;
      return (await getOwner(scope)) === instanceId;
    },
    renewOwner: async (scope) => {
      const { client: redis } = assertAvailable();
      const token = ownerTokens.get(roomDigest(scope));
      if (!token) return false;
      const renewed = await redis.eval(
        redisOwnerRenewScript,
        1,
        ownerKey(scope),
        token,
        String(leaseMs),
      );
      return Number(renewed) === 1;
    },
    releaseOwner: async (scope) => {
      const { client: redis } = assertAvailable();
      const digest = roomDigest(scope);
      const token = ownerTokens.get(digest);
      if (!token) return;
      await redis.eval(redisOwnerReleaseScript, 1, ownerKey(scope), token);
      ownerTokens.delete(digest);
    },
    allocateRevision: async (scope) => {
      const { client: redis } = assertAvailable();
      return Number(await redis.incr(revisionKey(scope)));
    },
    observeRevision: async (scope, revision) => {
      const { client: redis } = assertAvailable();
      await redis.eval(redisObserveRevisionScript, 1, revisionKey(scope), String(revision));
    },
    publish: async (scope, envelope) => {
      const { client: redis } = assertAvailable();
      const parsed = assertEnvelope(envelope);
      if (parsed.kind === 'update' || parsed.kind === 'bootstrap') {
        await redis.eval(
          redisObserveRevisionScript,
          1,
          revisionKey(scope),
          String(parsed.revision),
        );
      }
      await redis.publish(channelKey(scope), JSON.stringify(parsed));
    },
    reserveClient: async (scope, input) => {
      const { client: redis } = assertAvailable();
      const now = Date.now();
      const expiresAt = input.expiresAt ?? now + leaseMs;
      const member = `${input.clientKind}:${input.clientId}`;
      const result = await redis.eval(
        redisReservePresenceScript,
        1,
        presenceKey(scope),
        String(now),
        member,
        String(expiresAt),
        String(normalizePresenceMaxClients(input.maxClients)),
        input.clientKind,
      );
      // Keep the reservation alive until the ticket expiry (or lease fallback)
      // even when no later client disconnect callback reaches this instance.
      if (Number(result) === 1) {
        await redis.pexpire(presenceKey(scope), Math.max(1, expiresAt - now));
        return { accepted: true };
      }
      return { accepted: false, reason: 'full' };
    },
    releaseClient: async (scope, input) => {
      const { client: redis } = assertAvailable();
      await redis.eval(
        redisReleasePresenceScript,
        1,
        presenceKey(scope),
        `${input.clientKind}:${input.clientId}`,
      );
    },
    subscribe: async (scope, listener) => {
      const { subscriber: pubsub } = assertAvailable();
      const channel = channelKey(scope);
      let listeners = subscriptions.get(channel);
      if (!listeners) {
        listeners = new Set();
        subscriptions.set(channel, listeners);
        listeners.add(listener);
        try {
          await pubsub.subscribe(channel);
        } catch (error) {
          listeners.delete(listener);
          subscriptions.delete(channel);
          throw error;
        }
        return async () => {
          const current = subscriptions.get(channel);
          if (!current) return;
          current.delete(listener);
          if (current.size > 0) return;
          subscriptions.delete(channel);
          await pubsub.unsubscribe(channel);
        };
      }
      listeners.add(listener);
      return async () => {
        const current = subscriptions.get(channel);
        if (!current) return;
        current.delete(listener);
        if (current.size > 0) return;
        subscriptions.delete(channel);
        await pubsub.unsubscribe(channel);
      };
    },
    reserveReplay: async (replayKey, expiry) => {
      const { client: redis } = assertAvailable();
      const now = Date.now();
      const result = await redis.eval(
        redisReserveReplayScript,
        1,
        sharedReplayKey,
        String(now),
        createHash('sha256').update(replayKey).digest('hex'),
        String(now + expiresIn(expiry)),
        String(maxReplayEntries),
      );
      if (Number(result) === 1) return { accepted: true };
      return {
        accepted: false,
        reason: Number(result) === 0 ? ('full' as const) : ('replayed' as const),
      };
    },
    saveSnapshot: async (scope, snapshot) => {
      const { client: redis } = assertAvailable();
      const token = ownerTokens.get(roomDigest(scope));
      if (!token) return false;
      const payload = JSON.stringify({
        ...(snapshot.bootstrapReady === undefined
          ? {}
          : { bootstrapReady: snapshot.bootstrapReady }),
        revision: snapshot.revision,
        stateVector: Buffer.from(snapshot.stateVector).toString('base64'),
        update: Buffer.from(snapshot.update).toString('base64'),
      });
      const saved = await redis.eval(
        redisSaveSnapshotScript,
        2,
        ownerKey(scope),
        snapshotKey(scope),
        token,
        payload,
        String(snapshotTtlMs),
      );
      return Number(saved) === 1;
    },
  };
};

export const createMemoryCollaborationRoomBackend = createMemoryRoomBackend;
export const createRedisCollaborationRoomBackend = createRedisRoomBackend;

export const createPageCollaborationRoomBackend = async (
  options: {
    backend?: 'memory' | 'redis';
    environment?: string;
    instanceId?: string;
    redisUrl?: string;
    requireScope?: boolean;
    snapshotLoader?: CollaborationRoomSnapshotLoader;
    redisPrefix?: string;
  } = {},
): Promise<CollaborationRoomBackend> => {
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  const backend = options.backend ?? process.env.PAGE_COLLABORATION_BACKEND;
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  if (backend === 'memory') {
    if (environment !== 'development' && environment !== 'test') {
      throw new Error('Page collaboration memory backend is not allowed in production.');
    }
    return createMemoryRoomBackend({
      instanceId: options.instanceId,
      requireScope: options.requireScope ?? false,
      snapshotLoader: options.snapshotLoader,
    });
  }
  if (backend !== undefined && backend !== 'redis') {
    throw new Error(`Unsupported PAGE_COLLABORATION_BACKEND: ${backend}`);
  }
  if (!redisUrl) {
    throw new Error(
      'Page collaboration requires REDIS_URL and the Redis backend; set PAGE_COLLABORATION_BACKEND=memory only for development.',
    );
  }
  const result = createRedisRoomBackend({
    database: Number.isInteger(Number(process.env.REDIS_DATABASE))
      ? Number(process.env.REDIS_DATABASE)
      : undefined,
    instanceId: options.instanceId,
    password: process.env.REDIS_PASSWORD,
    prefix: options.redisPrefix ?? process.env.REDIS_PREFIX,
    redisUrl,
    requireScope: options.requireScope ?? true,
    snapshotLoader: options.snapshotLoader,
    tls: process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true',
    username: process.env.REDIS_USERNAME,
  });
  await result.initialize();
  return result;
};
