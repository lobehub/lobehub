const http = require('node:http');
const crypto = require('node:crypto');

const { WebSocket, WebSocketServer } = require('ws');

// `yjs` publishes separate CJS/ESM bundles. The tsx composition root installs
// the ESM module on globalThis before requiring this relay so both sides share
// the exact same constructors. Direct `node server.cjs` remains CJS-only.
const yjsRuntime = globalThis.__LOBE_PAGE_YJS__ || require('yjs');

const { Doc, applyUpdate, encodeStateAsUpdate, encodeStateVector } = yjsRuntime;

const LOBE_YJS_PROTOCOL = 'lobe-yjs-v1';
const LOBE_YJS_PROTOCOL_VERSION = 1;

const DEFAULTS = {
  bootstrapTimeoutMs: 10_000,
  cleanupIntervalMs: 60_000,
  heartbeatIntervalMs: 30_000,
  enableV1Protocol: true,
  allowLegacyProtocol: true,
  maxIdleRooms: 20,
  maxMessageBytes: 2 * 1024 * 1024,
  maxUpdateBytes: 1.5 * 1024 * 1024,
  maxAwarenessBytes: 64 * 1024,
  maxUpdatesPerSecond: 60,
  maxAwarenessPerSecond: 120,
  maxUpdateBytesPerSecond: 32 * 1024 * 1024,
  maxAwarenessBytesPerSecond: 4 * 1024 * 1024,
  // One human browser owns the visible editor room; up to five independently
  // authenticated Agent sessions may stream against disjoint request ranges.
  maxBrowserClients: 1,
  maxAgentClients: 5,
  rateLimitWindowMs: 1_000,
  roomIdleTtlMs: 30 * 60 * 1000,
  maxProcessedMessageIds: 10_000,
  roomUpdateDebounceMs: 500,
};

const encodeUpdate = (update) => Buffer.from(update).toString('base64');
const decodeUpdate = (update, maxBytes = Infinity) => {
  if (
    typeof update !== 'string' ||
    update.length % 4 === 1 ||
    !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(update)
  ) {
    throw new Error('Invalid base64 payload.');
  }

  const decoded = Buffer.from(update, 'base64');
  if (decoded.byteLength > maxBytes) throw new Error('Payload exceeds the configured limit.');
  return new Uint8Array(decoded);
};

// A Yjs state vector only records the next clock for each client. Deleting an
// already-created item (and, in particular, an Undo/Redo delete) can change
// the document without advancing any clock, so comparing state vectors cannot
// tell us whether an update actually changed the document. Listen to Yjs's
// transaction-level update event instead. The listener is scoped to this
// application of the update: duplicate/idempotent updates do not emit an
// update event, while inserts, deletes, and restores do.
const applyUpdateAndDetectChange = (doc, update, origin) => {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  doc.on('update', onUpdate);
  try {
    applyUpdate(doc, update, origin);
  } finally {
    doc.off('update', onUpdate);
  }
  return changed;
};

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isV1Message = (message) =>
  isRecord(message) &&
  message.protocol === LOBE_YJS_PROTOCOL &&
  message.version === LOBE_YJS_PROTOCOL_VERSION &&
  typeof message.type === 'string';
const isV1Position = (position) => {
  if (!isRecord(position)) return false;

  const isPositionPart = (part) =>
    isRecord(part) && Number.isSafeInteger(part.client) && Number.isSafeInteger(part.clock);

  return (
    (position.assoc === undefined || typeof position.assoc === 'number') &&
    (position.item === undefined || isPositionPart(position.item)) &&
    (position.tname === undefined ||
      position.tname === null ||
      typeof position.tname === 'string') &&
    (position.type === undefined || isPositionPart(position.type))
  );
};
const isV1State = (state) =>
  isRecord(state) &&
  (state.anchorPos === null || isV1Position(state.anchorPos)) &&
  (state.focusPos === null || isV1Position(state.focusPos)) &&
  typeof state.color === 'string' &&
  typeof state.focusing === 'boolean' &&
  typeof state.name === 'string' &&
  isRecord(state.awarenessData);
const isV1MessageValid = (message) => {
  if (!isV1Message(message)) return false;

  switch (message.type) {
    case 'auth': {
      return (
        Number.isSafeInteger(message.clientId) &&
        (message.clientKind === 'agent' || message.clientKind === 'browser') &&
        typeof message.nonce === 'string' &&
        (message.ticket === undefined ||
          message.ticket === null ||
          (typeof message.ticket === 'string' && message.ticket.length <= 8192)) &&
        (message.documentId === undefined ||
          (typeof message.documentId === 'string' && message.documentId.length <= 1024)) &&
        (message.requestId === undefined ||
          (typeof message.requestId === 'string' && message.requestId.length <= 1024))
      );
    }
    case 'awareness': {
      return (
        Number.isSafeInteger(message.sequence) &&
        message.sequence >= 0 &&
        (message.state === null || isV1State(message.state))
      );
    }
    case 'sync-request': {
      return typeof message.stateVector === 'string';
    }
    case 'update': {
      return (
        typeof message.messageId === 'string' &&
        message.messageId.length > 0 &&
        message.messageId.length <= 256 &&
        typeof message.update === 'string'
      );
    }
    default: {
      return false;
    }
  }
};

const sendJson = (response, statusCode, data) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(data === undefined ? undefined : JSON.stringify(data));
};

function createCollaborationServer(options = {}) {
  const configuredAuthValidator = options.ticketVerifier || options.authValidator;
  const normalizeClientLimit = (value, fallback, hardMaximum, allowTestOverride) => {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    // Production never permits an operator setting to exceed the protocol's
    // hard room contract. The browser-only test override keeps legacy
    // two-browser acceptance fixtures explicit without changing production.
    return allowTestOverride ? parsed : Math.min(parsed, hardMaximum);
  };
  const allowTestBrowserClientLimitOverride =
    process.env.NODE_ENV === 'test' && options.maxBrowserClients !== undefined;
  const config = {
    allowLegacyProtocol:
      options.allowLegacyProtocol ??
      (process.env.PAGE_COLLABORATION_ALLOW_LEGACY === undefined
        ? DEFAULTS.allowLegacyProtocol
        : process.env.PAGE_COLLABORATION_ALLOW_LEGACY !== '0'),
    // A collaboration server must never silently accept an unverified ticket.
    // The legacy protocol remains available for local editor demos, while v1
    // rejects every client until the host injects a verifier.
    authValidator:
      typeof configuredAuthValidator === 'function' ? configuredAuthValidator : () => false,
    maxProcessedMessageIds: Number(
      options.maxProcessedMessageIds ??
        process.env.PAGE_COLLABORATION_MAX_PROCESSED_MESSAGE_IDS ??
        DEFAULTS.maxProcessedMessageIds,
    ),
    bootstrapTimeoutMs: Number(
      options.bootstrapTimeoutMs ??
        process.env.PAGE_COLLABORATION_BOOTSTRAP_TIMEOUT_MS ??
        DEFAULTS.bootstrapTimeoutMs,
    ),
    cleanupIntervalMs: Number(
      options.cleanupIntervalMs ??
        process.env.PAGE_COLLABORATION_CLEANUP_INTERVAL_MS ??
        DEFAULTS.cleanupIntervalMs,
    ),
    heartbeatIntervalMs: Number(
      options.heartbeatIntervalMs ??
        process.env.PAGE_COLLABORATION_HEARTBEAT_INTERVAL_MS ??
        DEFAULTS.heartbeatIntervalMs,
    ),
    enableV1Protocol:
      options.enableV1Protocol ??
      (process.env.PAGE_COLLABORATION_ENABLE_V1 === undefined
        ? DEFAULTS.enableV1Protocol
        : process.env.PAGE_COLLABORATION_ENABLE_V1 !== '0'),
    // Room diagnostics contain document/room identifiers and client counts;
    // keep them disabled for production-facing servers unless explicitly
    // enabled by a local operator.
    exposeRoomDiagnostics: options.exposeRoomDiagnostics === true,
    maxIdleRooms: Number(
      options.maxIdleRooms ??
        process.env.PAGE_COLLABORATION_MAX_IDLE_ROOMS ??
        DEFAULTS.maxIdleRooms,
    ),
    maxMessageBytes: Number(
      options.maxMessageBytes ??
        process.env.PAGE_COLLABORATION_MAX_MESSAGE_BYTES ??
        DEFAULTS.maxMessageBytes,
    ),
    maxUpdateBytes: Number(
      options.maxUpdateBytes ??
        process.env.PAGE_COLLABORATION_MAX_UPDATE_BYTES ??
        DEFAULTS.maxUpdateBytes,
    ),
    maxAwarenessBytes: Number(
      options.maxAwarenessBytes ??
        process.env.PAGE_COLLABORATION_MAX_AWARENESS_BYTES ??
        DEFAULTS.maxAwarenessBytes,
    ),
    maxUpdatesPerSecond: Number(
      options.maxUpdatesPerSecond ??
        process.env.PAGE_COLLABORATION_MAX_UPDATES_PER_SECOND ??
        DEFAULTS.maxUpdatesPerSecond,
    ),
    maxAwarenessPerSecond: Number(
      options.maxAwarenessPerSecond ??
        process.env.PAGE_COLLABORATION_MAX_AWARENESS_PER_SECOND ??
        DEFAULTS.maxAwarenessPerSecond,
    ),
    maxUpdateBytesPerSecond: Number(
      options.maxUpdateBytesPerSecond ??
        process.env.PAGE_COLLABORATION_MAX_UPDATE_BYTES_PER_SECOND ??
        DEFAULTS.maxUpdateBytesPerSecond,
    ),
    maxAwarenessBytesPerSecond: Number(
      options.maxAwarenessBytesPerSecond ??
        process.env.PAGE_COLLABORATION_MAX_AWARENESS_BYTES_PER_SECOND ??
        DEFAULTS.maxAwarenessBytesPerSecond,
    ),
    maxBrowserClients: normalizeClientLimit(
      options.maxBrowserClients ??
        process.env.PAGE_COLLABORATION_MAX_BROWSER_CLIENTS ??
        DEFAULTS.maxBrowserClients,
      DEFAULTS.maxBrowserClients,
      DEFAULTS.maxBrowserClients,
      allowTestBrowserClientLimitOverride,
    ),
    maxAgentClients: normalizeClientLimit(
      options.maxAgentClients ??
        process.env.PAGE_COLLABORATION_MAX_AGENT_CLIENTS ??
        DEFAULTS.maxAgentClients,
      DEFAULTS.maxAgentClients,
      DEFAULTS.maxAgentClients,
      false,
    ),
    rateLimitWindowMs: Number(
      options.rateLimitWindowMs ??
        process.env.PAGE_COLLABORATION_RATE_LIMIT_WINDOW_MS ??
        DEFAULTS.rateLimitWindowMs,
    ),
    roomIdleTtlMs: Number(
      options.roomIdleTtlMs ??
        process.env.PAGE_COLLABORATION_ROOM_IDLE_TTL_MS ??
        DEFAULTS.roomIdleTtlMs,
    ),
    roomUpdateDebounceMs: Number(
      options.roomUpdateDebounceMs ??
        process.env.PAGE_COLLABORATION_ROOM_UPDATE_DEBOUNCE_MS ??
        DEFAULTS.roomUpdateDebounceMs,
    ),
  };
  const logger = options.logger || console;
  const now = options.now || Date.now;
  const onRoomUpdate = typeof options.onRoomUpdate === 'function' ? options.onRoomUpdate : null;
  const migrateLegacyBlockImagesInYjsDoc =
    typeof options.migrateLegacyBlockImagesInYjsDoc === 'function'
      ? options.migrateLegacyBlockImagesInYjsDoc
      : null;
  const roomBackend =
    options.roomBackend &&
    typeof options.roomBackend.ensureRoom === 'function' &&
    typeof options.roomBackend.publish === 'function'
      ? options.roomBackend
      : null;
  const roomBackendReady = roomBackend
    ? Promise.resolve().then(() => roomBackend.initialize?.())
    : Promise.resolve();
  const usesFormalTicketVerifier = typeof options.ticketVerifier === 'function';
  const requireAgentTicketClaims = options.requireAgentTicketClaims ?? usesFormalTicketVerifier;
  const rooms = new Map();
  const timers = new Set();
  const serverClientIdBase = roomBackend
    ? Math.max(
        1,
        (Number.parseInt(
          crypto
            .createHash('sha256')
            .update(String(roomBackend.instanceId))
            .digest('hex')
            .slice(0, 11),
          16,
        ) || 1) * 100,
      )
    : 1;
  let nextServerClientId = serverClientIdBase;
  const consumedTicketKeys = new Map();
  const inFlightTicketKeys = new Map();

  const rememberProcessedMessageId = (room, messageId) => {
    room.processedMessageIds.add(messageId);
    while (room.processedMessageIds.size > config.maxProcessedMessageIds) {
      const oldest = room.processedMessageIds.values().next().value;
      if (oldest === undefined) return;
      room.processedMessageIds.delete(oldest);
    }
  };

  const logRoomEvent = (event, room, details = {}) => {
    logger.info(
      `[page-collaboration] ${JSON.stringify({
        awarenessCount: room.awareness.size,
        clientCount: room.clients.size,
        event,
        roomId: room.id,
        timestamp: new Date().toISOString(),
        ...details,
      })}`,
    );
  };

  const copyBytes = (value) => (value ? new Uint8Array(value) : null);
  const stateVectorKey = (value) => (value ? Buffer.from(value).toString('base64') : null);

  const createPersistenceEvent = (room, details) => ({
    documentId: details.documentId || room.id,
    messageIds: details.messageId ? [details.messageId] : [],
    principal: details.principal || null,
    requestIds: details.requestId ? [details.requestId] : [],
    revision: room.revision,
    roomId: room.id,
    stateVector: copyBytes(details.stateVector),
    updateBytes: details.updateBytes || 0,
    updatedAt: now(),
  });

  const mergePersistenceEvent = (room, details) => {
    const persistence = room.persistence;
    const current = persistence.pendingEvent;
    if (!current) {
      persistence.pendingEvent = createPersistenceEvent(room, details);
      return;
    }

    current.documentId = details.documentId || current.documentId || room.id;
    // A browser keystroke and an Agent direct rewrite may land in the same
    // debounce window. Prefer the Agent principal whenever the merged event
    // carries a request id; otherwise retaining the first principal keeps
    // ordinary browser autosave attribution stable. Without this preference,
    // the browser event could hide the Agent request id and the worker would
    // wait forever for its durable history proof.
    if (details.requestId && details.principal?.clientKind === 'agent') {
      current.principal = details.principal;
    } else {
      current.principal = current.principal || details.principal || null;
    }
    current.revision = room.revision;
    current.stateVector = copyBytes(details.stateVector);
    current.updatedAt = now();
    current.updateBytes += details.updateBytes || 0;
    if (details.messageId && !current.messageIds.includes(details.messageId)) {
      current.messageIds.push(details.messageId);
    }
    if (details.requestId && !current.requestIds.includes(details.requestId)) {
      current.requestIds.push(details.requestId);
    }
  };

  const flushRoomPersistence = (room, reason = 'manual') => {
    if (!onRoomUpdate) return Promise.resolve(null);
    if (roomBackend && !room.backend.isOwner) return Promise.resolve(null);
    if (room.persistence.inFlight) return room.persistence.inFlight;
    if (!room.persistence.pendingEvent) return Promise.resolve(null);

    if (reason !== 'debounce' && reason !== 'debounce-follow-up') {
      room.persistence.retryBlocked = false;
    }

    if (room.persistence.debounceTimer) {
      clearTimeout(room.persistence.debounceTimer);
      room.persistence.debounceTimer = null;
    }

    const run = async () => {
      let result = null;
      while (room.persistence.pendingEvent) {
        const event = room.persistence.pendingEvent;
        room.persistence.pendingEvent = null;
        event.reason = reason;
        // Capture an immutable-by-convention Yjs payload before invoking the
        // adapter. The callback never receives the live room Doc: updates that
        // arrive while it is awaiting storage must be persisted in a separate
        // follow-up event with its own revision/state vector.
        const snapshotUpdate = encodeStateAsUpdate(room.doc);
        event.snapshot = {
          stateVector: copyBytes(encodeStateVector(room.doc)),
          update: copyBytes(snapshotUpdate),
        };
        event.stateVector = copyBytes(event.snapshot.stateVector);
        const fingerprint = `${event.revision}:${stateVectorKey(event.stateVector)}`;

        if (fingerprint === room.persistence.lastPersistedFingerprint) continue;

        try {
          result = await onRoomUpdate(event);
        } catch (error) {
          // Keep the latest snapshot available for a later retry. A failed
          // persistence callback must never make room eviction silently lose
          // the update.
          room.persistence.pendingEvent = event;
          room.persistence.retryBlocked = true;
          logRoomEvent('persistence.failed', room, {
            message: error instanceof Error ? error.message : String(error),
            revision: event.revision,
          });
          throw error;
        }

        const isConflict =
          result && (result.status === 'conflict' || result.reason === 'cas-conflict');
        if (isConflict) {
          room.persistence.pendingEvent = event;
          room.persistence.retryBlocked = true;
          logRoomEvent('persistence.conflict', room, { revision: event.revision });
          break;
        }

        if (roomBackend && room.backend.isOwner && room.backend.scope) {
          try {
            await roomBackend.saveSnapshot(room.backend.scope, {
              ...(migrateLegacyBlockImagesInYjsDoc && room.backend.bootstrapRequired
                ? { bootstrapReady: room.backend.bootstrapReady }
                : {}),
              revision: event.revision,
              stateVector: new Uint8Array(event.snapshot.stateVector),
              update: new Uint8Array(event.snapshot.update),
            });
          } catch (error) {
            // The database projection remains authoritative when Redis is
            // briefly unavailable. Keep the room write result, but surface
            // the outage and let the lease/fail-closed path stop new writes.
            logRoomEvent('backend.snapshot.failed', room, {
              message: error instanceof Error ? error.message : String(error),
              revision: event.revision,
            });
          }
        }

        room.persistence.lastPersistedRevision = Math.max(
          room.persistence.lastPersistedRevision,
          event.revision,
        );
        room.persistence.lastPersistedFingerprint = fingerprint;
        room.persistence.lastPersistedStateVector = stateVectorKey(event.stateVector);
      }
      return result;
    };

    const promise = run().finally(() => {
      room.persistence.inFlight = null;
      // Updates can arrive while the callback is running. A follow-up is
      // deliberately debounced again instead of recursively writing in the
      // same stack, keeping bursts coalesced and avoiding update loops.
      if (
        room.persistence.pendingEvent &&
        !room.persistence.retryBlocked &&
        !room.persistence.debounceTimer
      ) {
        room.persistence.debounceTimer = setTimeout(() => {
          room.persistence.debounceTimer = null;
          void flushRoomPersistence(room, 'debounce-follow-up').catch(() => {});
        }, config.roomUpdateDebounceMs);
        room.persistence.debounceTimer.unref?.();
      }
    });
    room.persistence.inFlight = promise;
    return promise;
  };

  const scheduleRoomPersistence = (room, details) => {
    if (!onRoomUpdate) return;
    room.persistence.retryBlocked = false;
    mergePersistenceEvent(room, details);
    if (room.persistence.debounceTimer) clearTimeout(room.persistence.debounceTimer);
    room.persistence.debounceTimer = setTimeout(() => {
      room.persistence.debounceTimer = null;
      void flushRoomPersistence(room, 'debounce').catch(() => {});
    }, config.roomUpdateDebounceMs);
    room.persistence.debounceTimer.unref?.();
  };

  const getRoom = (id) => {
    let room = rooms.get(id);
    if (room) return room;

    const nowValue = now();
    room = {
      awareness: new Map(),
      awarenessSequences: new Map(),
      backend: {
        bootstrapError: null,
        bootstrapPromise: null,
        bootstrapRetryCount: 0,
        bootstrapRequired: false,
        bootstrapReady: false,
        bootstrapTimer: null,
        ensurePromise: null,
        hydrating: false,
        isOwner: false,
        leaseTimer: null,
        ownerId: null,
        operationQueue: null,
        pendingEnvelopes: [],
        seenEnvelopes: new Set(),
        scope: null,
        scopeKey: null,
        snapshotApplied: false,
        subscribed: false,
        unsubscribe: null,
        sequence: 0,
      },
      bootstrapOwner: null,
      bootstrapOwnerClientId: null,
      bootstrapTimer: null,
      clients: new Set(),
      deferredSyncClients: new Map(),
      doc: new Doc(),
      hasReceivedUpdate: false,
      id,
      lastActiveAt: nowValue,
      lastEmptyAt: nowValue,
      processedMessageIds: new Set(),
      revision: 0,
      lastUpdatePrincipal: null,
      persistence: {
        debounceTimer: null,
        inFlight: null,
        lastPersistedRevision: 0,
        lastPersistedFingerprint: null,
        lastPersistedStateVector: null,
        pendingEvent: null,
        retryBlocked: false,
        evicting: false,
      },
    };
    rooms.set(id, room);
    logRoomEvent('room.created', room);
    return room;
  };

  const createBackendScope = (room, principal) => {
    const documentId = principal?.documentId || room.id;
    const workspaceId = principal?.workspaceId ?? null;
    const userId = principal?.userId ?? null;
    if (documentId !== room.id) {
      throw new Error('Collaboration backend document scope does not match the room.');
    }
    return {
      documentId,
      roomId: room.id,
      // Workspace documents are shared by all authorized members. Private
      // documents keep userId in the key so a reused document id can never
      // cross a personal tenant boundary.
      userId,
      workspaceId,
    };
  };

  const backendScopeKey = (scope) =>
    JSON.stringify({
      documentId: scope.documentId,
      roomId: scope.roomId,
      userId: scope.workspaceId ? null : (scope.userId ?? null),
      workspaceId: scope.workspaceId ?? null,
    });

  const createBackendPrincipal = (principal) => {
    if (!isRecord(principal)) return null;
    const allowedKeys = [
      'authoritative',
      'canWrite',
      'clientKind',
      'documentId',
      'requestId',
      'roomId',
      'userId',
      'workspaceId',
    ];
    const result = {};
    for (const key of allowedKeys) {
      if (principal[key] !== undefined) result[key] = principal[key];
    }
    return result;
  };

  const drainBackendRoom = async (room, reason) => {
    if (!roomBackend) return;
    if (room.backend.leaseTimer) clearInterval(room.backend.leaseTimer);
    room.backend.leaseTimer = null;
    const unsubscribe = room.backend.unsubscribe;
    room.backend.unsubscribe = null;
    room.backend.subscribed = false;
    const cleanupTasks = [];
    if (unsubscribe) cleanupTasks.push(unsubscribe());
    if (room.backend.scope) cleanupTasks.push(roomBackend.releaseOwner(room.backend.scope));
    if (room.backend.bootstrapTimer) clearTimeout(room.backend.bootstrapTimer);
    room.backend.bootstrapTimer = null;
    await Promise.allSettled(cleanupTasks);
    logRoomEvent('backend.room-closed', room, { reason });
  };

  const closeBackendRoom = (room, reason) => {
    void drainBackendRoom(room, reason);
  };

  const failBackendRoom = (room, error) => {
    logRoomEvent('backend.unavailable', room, {
      message: error instanceof Error ? error.message : String(error),
    });
    const message = JSON.stringify({
      code: 'backend_unavailable',
      fatal: true,
      message: 'The collaboration room backend is temporarily unavailable.',
      protocol: LOBE_YJS_PROTOCOL,
      type: 'error',
      version: LOBE_YJS_PROTOCOL_VERSION,
    });
    for (const socket of room.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.protocolMode === 'v1') socket.send(message);
      socket.close(1013, 'Collaboration room backend unavailable.');
    }
  };

  const finishBackendBootstrap = (room) => {
    if (roomBackend && room.backend.bootstrapRequired && !room.backend.bootstrapReady) {
      return null;
    }
    if (room.hasReceivedUpdate) return null;
    room.hasReceivedUpdate = true;
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    room.bootstrapTimer = null;
    room.bootstrapOwner = null;
    room.bootstrapOwnerClientId = null;
    if (room.backend.bootstrapTimer) clearTimeout(room.backend.bootstrapTimer);
    room.backend.bootstrapTimer = null;
    return flushDeferredSyncClients(room);
  };

  let handleBackendEnvelope;

  const drainPendingBackendEnvelopes = async (room) => {
    if (!handleBackendEnvelope || room.backend.hydrating) return;
    const pendingEnvelopes = room.backend.pendingEnvelopes.splice(0);
    for (const envelope of pendingEnvelopes) {
      if (!room.backend.bootstrapReady && envelope.kind !== 'bootstrap') {
        room.backend.pendingEnvelopes.push(envelope);
        continue;
      }
      await handleBackendEnvelope(room, envelope);
    }
  };

  const enqueueBackendOperation = (room, operation) => {
    const previous = room.backend.operationQueue || Promise.resolve();
    const tracked = previous.catch(() => undefined).then(operation);
    room.backend.operationQueue = tracked;
    tracked
      .finally(() => {
        if (room.backend.operationQueue === tracked) room.backend.operationQueue = null;
      })
      .catch(() => {});
    return tracked;
  };

  const runBackendBootstrap = (room, principal) => {
    if (
      !migrateLegacyBlockImagesInYjsDoc ||
      !roomBackend ||
      !room.backend.scope ||
      room.backend.bootstrapReady
    ) {
      return Promise.resolve(false);
    }
    if (!room.backend.isOwner) return Promise.resolve(false);
    if (room.backend.bootstrapPromise) return room.backend.bootstrapPromise;

    const sourceUpdate = new Uint8Array(encodeStateAsUpdate(room.doc));
    const sourceStateVector = new Uint8Array(encodeStateVector(room.doc));
    const sourceRevision = room.revision;
    let committed = false;
    let liveApplied = false;
    const operation = (async () => {
      let migration = {
        changed: false,
        stateVector: new Uint8Array(sourceStateVector),
        update: (() => {
          const empty = new Doc();
          try {
            return new Uint8Array(encodeStateAsUpdate(empty));
          } finally {
            empty.destroy();
          }
        })(),
      };

      if (migrateLegacyBlockImagesInYjsDoc) {
        const migrationInput = new Doc();
        try {
          applyUpdate(migrationInput, sourceUpdate, room.backend);
          migration = await migrateLegacyBlockImagesInYjsDoc({
            doc: migrationInput,
            roomId: room.id,
          });
        } finally {
          migrationInput.destroy();
        }
      }

      if (
        !migration ||
        typeof migration.changed !== 'boolean' ||
        !(migration.update instanceof Uint8Array) ||
        !(migration.stateVector instanceof Uint8Array)
      ) {
        throw new Error('Invalid legacy block-image migration result.');
      }

      const candidate = new Doc();
      try {
        applyUpdate(candidate, sourceUpdate, room.backend);
        if (migration.changed) applyUpdate(candidate, migration.update, room.backend);
        const candidateStateVector = new Uint8Array(encodeStateVector(candidate));
        if (!Buffer.from(candidateStateVector).equals(Buffer.from(migration.stateVector))) {
          throw new Error('Legacy block-image migration state vector mismatch.');
        }
        const candidateUpdate = new Uint8Array(encodeStateAsUpdate(candidate));

        if (!(await roomBackend.isOwner(room.backend.scope))) return false;
        // The live room is held behind the bootstrap gate while this
        // candidate is prepared. Check it immediately before the fenced save
        // so a concurrent backend envelope cannot make the persisted
        // candidate diverge from the live Doc before commit.
        if (!Buffer.from(encodeStateVector(room.doc)).equals(Buffer.from(sourceStateVector))) {
          return false;
        }
        const candidateRevision = migration.changed
          ? await roomBackend.allocateRevision(room.backend.scope)
          : sourceRevision;
        const saved = await roomBackend.saveSnapshot(room.backend.scope, {
          bootstrapReady: true,
          revision: candidateRevision,
          stateVector: candidateStateVector,
          update: candidateUpdate,
        });
        if (!saved || !(await roomBackend.isOwner(room.backend.scope))) return false;

        // `saveSnapshot` plus the second owner check is the commit fence. The
        // candidate is durable authority from this point forward, even if the
        // lease expires while the live Doc is updated or the ready envelope is
        // published. There is deliberately no replacement/rollback of the
        // live Doc after this point: doing so drops Yjs listeners and awareness
        // closures and can erase later work.
        committed = true;

        if (migration.changed) {
          const changed = applyUpdateAndDetectChange(room.doc, migration.update, room.backend);
          if (!changed) throw new Error('Legacy block-image migration delta was not applied.');
          liveApplied = true;
        } else {
          // A no-op migration already has the candidate state in the live Doc;
          // a later publish failure must not be mistaken for a live-apply
          // failure and trigger an unnecessary room shutdown.
          liveApplied = true;
        }
        room.revision = candidateRevision;

        room.backend.sequence += 1;
        await roomBackend.publish(room.backend.scope, {
          bootstrapReady: true,
          kind: 'bootstrap',
          messageId: `bootstrap:${room.id}:${crypto.randomUUID()}`,
          origin: roomBackend.instanceId,
          principal: createBackendPrincipal(room.lastUpdatePrincipal || principal),
          revision: room.revision,
          sequence: room.backend.sequence,
          sender: serverClientIdBase,
          stateVector: encodeUpdate(candidateStateVector),
          update: encodeUpdate(migration.update),
        });
        room.backend.bootstrapReady = true;
        room.backend.bootstrapError = null;
        finishBackendBootstrap(room);
        return true;
      } finally {
        candidate.destroy();
      }
    })()
      .catch((error) => {
        if (committed) {
          // The persisted candidate cannot be undone by a late lease loss or
          // publish failure. Keep the room's existing Doc/listeners intact;
          // callers can reconnect and hydrate the committed snapshot.
          room.backend.bootstrapReady = true;
          room.backend.bootstrapError = null;
          if (liveApplied) {
            finishBackendBootstrap(room);
          } else {
            failBackendRoom(room, error);
          }
          logRoomEvent('backend.bootstrap.committed-after-error', room, {
            message: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
        room.backend.bootstrapError = error instanceof Error ? error.message : String(error);
        return false;
      })
      .finally(() => {
        if (room.backend.bootstrapPromise === operation) room.backend.bootstrapPromise = null;
      });
    room.backend.bootstrapPromise = operation;
    return operation;
  };

  const attemptBackendBootstrap = (room, principal) => {
    if (
      !migrateLegacyBlockImagesInYjsDoc ||
      !room.backend.bootstrapRequired ||
      room.backend.bootstrapReady ||
      !room.backend.isOwner ||
      room.backend.bootstrapPromise ||
      room.backend.bootstrapRetryCount >= 3
    ) {
      return Promise.resolve(false);
    }
    room.backend.bootstrapRetryCount += 1;
    return runBackendBootstrap(room, principal).then((completed) => {
      if (completed) room.backend.bootstrapRetryCount = 0;
      return completed;
    });
  };

  const ensureBackendRoom = (room, principal) => {
    if (!roomBackend) return Promise.resolve(null);
    const scope = createBackendScope(room, principal);
    const identity = backendScopeKey(scope);
    if (room.backend.scopeKey && room.backend.scopeKey !== identity) {
      return Promise.reject(new Error('Collaboration room scope cannot be changed.'));
    }
    if (room.backend.ensurePromise) return room.backend.ensurePromise;

    room.backend.scope = scope;
    room.backend.scopeKey = identity;
    room.backend.hydrating = true;
    room.backend.ensurePromise = (async () => {
      await roomBackendReady;
      if (typeof roomBackend.healthy === 'function' && !roomBackend.healthy()) {
        throw new Error('Page collaboration room backend is unavailable.');
      }

      if (!room.backend.subscribed) {
        room.backend.unsubscribe = await roomBackend.subscribe(scope, (envelope) => {
          if (room.backend.hydrating) {
            room.backend.pendingEnvelopes.push(envelope);
            return;
          }
          void enqueueBackendOperation(room, () => handleBackendEnvelope(room, envelope)).catch(
            (error) => failBackendRoom(room, error),
          );
        });
        room.backend.subscribed = true;
      }

      const state = await roomBackend.ensureRoom(scope);
      const wasOwner = room.backend.isOwner;
      room.backend.ownerId = state.ownerId;
      room.backend.isOwner = state.ownerId === roomBackend.instanceId;
      room.backend.bootstrapReady = state.bootstrapReady === true;
      room.revision = Math.max(room.revision, state.revision || 0);

      const currentStateVector = encodeStateVector(room.doc);
      const snapshotStateVector = state.snapshot?.stateVector;
      const snapshotDiffers =
        state.snapshot &&
        snapshotStateVector &&
        !Buffer.from(currentStateVector).equals(Buffer.from(snapshotStateVector));
      const shouldApplySnapshot =
        state.snapshot &&
        ((!room.backend.snapshotApplied && !room.hasReceivedUpdate) ||
          (state.snapshotSource === 'backend' && snapshotDiffers));
      if (shouldApplySnapshot) {
        applyUpdate(room.doc, new Uint8Array(state.snapshot.update), room.backend);
        room.revision = Math.max(room.revision, state.snapshot.revision || 0);
      }
      if (state.snapshot?.bootstrapReady === true) room.backend.bootstrapReady = true;
      room.backend.snapshotApplied = true;

      // A configured migration is only needed for an authoritative snapshot.
      // A room without one must retain the existing browser-owned seed flow;
      // an empty in-memory Doc is not durable state and cannot complete the
      // initial-sync barrier by itself.
      room.backend.bootstrapRequired = Boolean(state.snapshot);
      room.backend.bootstrapReady =
        !room.backend.bootstrapRequired ||
        !migrateLegacyBlockImagesInYjsDoc ||
        state.snapshot?.bootstrapReady === true;
      if (room.backend.bootstrapReady) room.backend.bootstrapRetryCount = 0;

      if (room.backend.bootstrapRequired && room.backend.isOwner) {
        await attemptBackendBootstrap(room, principal);
      }

      room.backend.hydrating = false;
      await drainPendingBackendEnvelopes(room);
      if (room.backend.bootstrapRequired && room.backend.bootstrapReady) {
        finishBackendBootstrap(room);
      }

      if (room.backend.isOwner && !wasOwner && room.hasReceivedUpdate) {
        const principalForPersistence = room.lastUpdatePrincipal || principal || null;
        scheduleRoomPersistence(room, {
          documentId: room.id,
          principal: principalForPersistence,
          requestId: principalForPersistence?.requestId || null,
          stateVector: encodeStateVector(room.doc),
          updateBytes: 0,
        });
      }

      if (!room.backend.leaseTimer) {
        const renewalMs = Math.max(500, Number(roomBackend.leaseRenewalMs) || 5_000);
        room.backend.leaseTimer = setInterval(() => {
          if (!room.backend.scope || !roomBackend) return;
          void roomBackend
            .renewOwner(room.backend.scope)
            .then((renewed) => {
              if (renewed) {
                room.backend.isOwner = true;
                room.backend.ownerId = roomBackend.instanceId;
                if (
                  room.backend.bootstrapRequired &&
                  !room.backend.bootstrapReady &&
                  !room.backend.bootstrapPromise
                ) {
                  void attemptBackendBootstrap(room, room.lastUpdatePrincipal || null)
                    .then(() => {
                      if (room.backend.bootstrapReady) finishBackendBootstrap(room);
                    })
                    .catch((error) => failBackendRoom(room, error));
                }
                return;
              }
              room.backend.isOwner = false;
              void roomBackend
                .ensureRoom(room.backend.scope)
                .then(async (nextState) => {
                  room.backend.ownerId = nextState.ownerId;
                  const becameOwner =
                    !room.backend.isOwner && nextState.ownerId === roomBackend.instanceId;
                  room.backend.isOwner = nextState.ownerId === roomBackend.instanceId;
                  room.revision = Math.max(room.revision, nextState.revision || 0);
                  if (nextState.snapshot) {
                    const nextSnapshotStateVector = nextState.snapshot.stateVector;
                    const currentStateVector = encodeStateVector(room.doc);
                    if (
                      !Buffer.from(currentStateVector).equals(Buffer.from(nextSnapshotStateVector))
                    ) {
                      applyUpdate(
                        room.doc,
                        new Uint8Array(nextState.snapshot.update),
                        room.backend,
                      );
                      room.revision = Math.max(room.revision, nextState.snapshot.revision || 0);
                    }
                    room.backend.bootstrapRequired = Boolean(
                      migrateLegacyBlockImagesInYjsDoc &&
                      nextState.snapshot.bootstrapReady !== true,
                    );
                    room.backend.bootstrapReady = !room.backend.bootstrapRequired;
                  } else if (!migrateLegacyBlockImagesInYjsDoc) {
                    room.backend.bootstrapRequired = false;
                    room.backend.bootstrapReady = true;
                  }
                  if (room.backend.bootstrapReady) room.backend.bootstrapRetryCount = 0;
                  if (room.backend.bootstrapReady && nextState.snapshot) {
                    await drainPendingBackendEnvelopes(room);
                    finishBackendBootstrap(room);
                  }
                  if (
                    becameOwner &&
                    room.backend.bootstrapRequired &&
                    !room.backend.bootstrapReady
                  ) {
                    void attemptBackendBootstrap(room, room.lastUpdatePrincipal || null)
                      .then(() => {
                        if (room.backend.bootstrapReady) finishBackendBootstrap(room);
                      })
                      .catch((error) => failBackendRoom(room, error));
                  }
                  if (becameOwner && room.hasReceivedUpdate) {
                    scheduleRoomPersistence(room, {
                      documentId: room.id,
                      principal: room.lastUpdatePrincipal,
                      requestId: room.lastUpdatePrincipal?.requestId || null,
                      stateVector: encodeStateVector(room.doc),
                      updateBytes: 0,
                    });
                  }
                })
                .catch((error) => failBackendRoom(room, error));
            })
            .catch((error) => {
              room.backend.isOwner = false;
              failBackendRoom(room, error);
            });
        }, renewalMs);
        room.backend.leaseTimer.unref?.();
      }

      return state;
    })().finally(() => {
      room.backend.hydrating = false;
      room.backend.ensurePromise = null;
    });
    return room.backend.ensurePromise;
  };

  const getRoomDiagnostics = () =>
    Array.from(rooms.values()).map((room) => ({
      awarenessCount: room.awareness.size,
      backendOwnerId: room.backend.ownerId,
      backendOwnedByThisInstance: room.backend.isOwner,
      backendMode: roomBackend?.mode || 'memory-local',
      backendBootstrapReady: room.backend.bootstrapReady,
      backendBootstrapRequired: room.backend.bootstrapRequired,
      bootstrapClientId: room.bootstrapOwnerClientId,
      clientCount: room.clients.size,
      deferredSyncClientCount: room.deferredSyncClients.size,
      id: room.id,
      lastActiveAt: new Date(room.lastActiveAt).toISOString(),
      lastEmptyAt: room.lastEmptyAt ? new Date(room.lastEmptyAt).toISOString() : null,
      persistencePending: Boolean(room.persistence.pendingEvent || room.persistence.inFlight),
      persistedRevision: room.persistence.lastPersistedRevision,
      persistedStateVector: room.persistence.lastPersistedStateVector,
      revision: room.revision,
      stateVector: encodeUpdate(encodeStateVector(room.doc)),
      status: room.clients.size > 0 ? 'active' : 'idle',
    }));

  const getServerMetrics = () => {
    const roomList = Array.from(rooms.values());
    return {
      activeRooms: roomList.filter((room) => room.clients.size > 0).length,
      backendHealthy: !roomBackend || roomBackend.healthy(),
      backendMode: roomBackend?.mode || 'memory-local',
      clients: roomList.reduce((total, room) => total + room.clients.size, 0),
      idleRooms: roomList.filter((room) => room.clients.size === 0).length,
      pendingPersistence: roomList.filter(
        (room) => room.persistence.pendingEvent || room.persistence.inFlight,
      ).length,
      rooms: roomList.length,
    };
  };

  const disposeRoom = (room, reason) => {
    logRoomEvent('room.evicted', room, { reason, revision: room.revision });
    closeBackendRoom(room, reason);
    room.doc.destroy();
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    if (room.backend.bootstrapTimer) clearTimeout(room.backend.bootstrapTimer);
    if (room.persistence.debounceTimer) clearTimeout(room.persistence.debounceTimer);
    room.bootstrapTimer = null;
    room.backend.bootstrapTimer = null;
    room.persistence.debounceTimer = null;
    room.awareness.clear();
    room.awarenessSequences.clear();
    room.processedMessageIds.clear();
    room.backend.seenEnvelopes.clear();
    room.backend.pendingEnvelopes.length = 0;
    room.backend.bootstrapPromise = null;
    room.deferredSyncClients.clear();
    rooms.delete(room.id);
  };

  const evictRoom = (room, reason) => {
    if (room.persistence.evicting) return room.persistence.evictionPromise;
    room.persistence.evicting = true;

    const hasPendingPersistence =
      Boolean(room.persistence.pendingEvent) || Boolean(room.persistence.inFlight);
    if (!hasPendingPersistence || !onRoomUpdate) {
      disposeRoom(room, reason);
      return null;
    }

    const flush = flushRoomPersistence(room, `eviction:${reason}`)
      .then(() => {
        if (room.persistence.pendingEvent) {
          room.persistence.evicting = false;
          return false;
        }
        if (room.clients.size === 0 && rooms.get(room.id) === room) {
          disposeRoom(room, reason);
          return true;
        }
        room.persistence.evicting = false;
        return false;
      })
      .catch(() => {
        // Keep the room alive after a failed flush so a later update or an
        // explicit flush can retry rather than discarding the unsaved state.
        room.persistence.evicting = false;
        return false;
      });
    room.persistence.evictionPromise = flush;
    return flush;
  };

  const cleanupIdleRooms = async () => {
    const nowValue = now();
    let idleRooms = Array.from(rooms.values())
      .filter((room) => room.clients.size === 0)
      .sort((a, b) => a.lastEmptyAt - b.lastEmptyAt);

    const evictionPromises = [];

    for (const room of idleRooms) {
      if (nowValue - room.lastEmptyAt >= config.roomIdleTtlMs) {
        const eviction = evictRoom(room, 'idle ttl');
        if (eviction) evictionPromises.push(eviction);
      }
    }

    idleRooms = Array.from(rooms.values())
      .filter((room) => room.clients.size === 0)
      .sort((a, b) => a.lastEmptyAt - b.lastEmptyAt);
    while (idleRooms.length > config.maxIdleRooms) {
      const eviction = evictRoom(idleRooms.shift(), 'idle room limit');
      if (eviction) evictionPromises.push(eviction);
    }

    if (evictionPromises.length > 0) await Promise.all(evictionPromises);
  };

  const broadcast = (room, sender, message, protocolMode, excludedClients) => {
    const payload = JSON.stringify(message);
    for (const client of room.clients) {
      if (
        client !== sender &&
        !excludedClients?.has(client) &&
        client.readyState === WebSocket.OPEN &&
        client.hasSentInitialSync &&
        (!protocolMode ||
          (client.protocolMode === protocolMode && (protocolMode !== 'v1' || client.authenticated)))
      ) {
        client.send(payload);
      }
    }
  };

  const sendRoomSync = (room, socket, clientId, stateVector) => {
    if (socket.readyState !== WebSocket.OPEN || socket.hasSentInitialSync) return;
    if (roomBackend && !room.backend.bootstrapReady) return;
    const update = stateVector
      ? encodeStateAsUpdate(room.doc, stateVector)
      : encodeStateAsUpdate(room.doc);
    const awareness = Array.from(room.awareness, ([awarenessClientId, state]) => ({
      clientId: awarenessClientId,
      sequence: room.awarenessSequences.get(awarenessClientId) || 0,
      state,
    }));
    socket.hasSentInitialSync = true;
    logRoomEvent('sync.sent', room, {
      clientId,
      stateBytes: update.byteLength,
      stateVectorBytes: stateVector?.byteLength || 0,
    });

    if (socket.protocolMode === 'v1') {
      socket.send(
        JSON.stringify({
          awareness,
          protocol: LOBE_YJS_PROTOCOL,
          revision: room.revision,
          serverStateVector: encodeUpdate(encodeStateVector(room.doc)),
          type: 'sync',
          update: encodeUpdate(update),
          version: LOBE_YJS_PROTOCOL_VERSION,
        }),
      );
      return;
    }

    socket.send(
      JSON.stringify({
        awareness,
        revision: room.revision,
        type: 'sync',
        update: encodeUpdate(update),
      }),
    );
  };

  handleBackendEnvelope = async (room, envelope) => {
    if (
      !roomBackend ||
      rooms.get(room.id) !== room ||
      !envelope ||
      envelope.origin === roomBackend.instanceId
    )
      return;
    const envelopeKey = `${envelope.kind}:${envelope.origin}:${envelope.sequence}`;
    if (!room.backend.bootstrapReady && envelope.kind !== 'bootstrap') {
      if (
        !room.backend.pendingEnvelopes.some(
          (pending) => `${pending.kind}:${pending.origin}:${pending.sequence}` === envelopeKey,
        )
      ) {
        room.backend.pendingEnvelopes.push(envelope);
      }
      return;
    }
    if (room.backend.seenEnvelopes.has(envelopeKey)) return;
    room.backend.seenEnvelopes.add(envelopeKey);
    while (room.backend.seenEnvelopes.size > config.maxProcessedMessageIds) {
      const oldest = room.backend.seenEnvelopes.values().next().value;
      if (oldest === undefined) break;
      room.backend.seenEnvelopes.delete(oldest);
    }

    if (envelope.kind === 'bootstrap') {
      const update = decodeUpdate(envelope.update, config.maxUpdateBytes);
      const expectedStateVector = decodeUpdate(envelope.stateVector, config.maxUpdateBytes);
      const currentStateVector = encodeStateVector(room.doc);
      if (Buffer.from(currentStateVector).equals(Buffer.from(expectedStateVector))) {
        room.revision = Math.max(room.revision, envelope.revision);
        room.lastActiveAt = now();
        room.backend.bootstrapReady = true;
        room.backend.bootstrapError = null;
        room.backend.bootstrapRetryCount = 0;
        await drainPendingBackendEnvelopes(room);
        finishBackendBootstrap(room);
        return;
      }
      applyUpdateAndDetectChange(room.doc, update, room.backend);
      if (!Buffer.from(encodeStateVector(room.doc)).equals(Buffer.from(expectedStateVector))) {
        throw new Error('Page collaboration bootstrap state vector diverged.');
      }
      room.revision = Math.max(room.revision, envelope.revision);
      room.lastActiveAt = now();
      room.backend.bootstrapReady = true;
      room.backend.bootstrapError = null;
      room.backend.bootstrapRetryCount = 0;
      await drainPendingBackendEnvelopes(room);
      finishBackendBootstrap(room);
      return;
    }

    if (envelope.kind === 'update') {
      const processedBackendMessageId = `backend:${envelope.origin}:${envelope.messageId}`;
      if (room.processedMessageIds.has(processedBackendMessageId)) return;
      const update = decodeUpdate(envelope.update, config.maxUpdateBytes);
      if (room.backend.scope && typeof roomBackend.observeRevision === 'function') {
        await roomBackend.observeRevision(room.backend.scope, envelope.revision);
      }
      const changed = applyUpdateAndDetectChange(room.doc, update, room.backend);
      const stateVector = encodeStateVector(room.doc);
      rememberProcessedMessageId(room, processedBackendMessageId);
      room.revision = Math.max(room.revision, envelope.revision);
      room.lastActiveAt = now();
      const bootstrapClients = !room.hasReceivedUpdate ? finishBackendBootstrap(room) : null;
      if (changed) {
        room.lastUpdatePrincipal = envelope.principal || null;
        if (room.backend.isOwner) {
          scheduleRoomPersistence(room, {
            documentId: envelope.principal?.documentId || room.id,
            messageId: envelope.messageId,
            principal: envelope.principal || null,
            requestId: envelope.principal?.requestId || null,
            stateVector,
            updateBytes: update.byteLength,
          });
        }
      }
      if (changed) await saveBackendRoomSnapshot(room);

      if (changed) {
        broadcast(
          room,
          null,
          {
            messageId: envelope.messageId,
            protocol: LOBE_YJS_PROTOCOL,
            revision: room.revision,
            sender: envelope.sender,
            type: 'update',
            update: envelope.update,
            version: LOBE_YJS_PROTOCOL_VERSION,
          },
          'v1',
          bootstrapClients,
        );
      }
      return;
    }

    const remoteClientId = envelope.awareness.clientId;
    const previousSequence = room.awarenessSequences.get(remoteClientId) ?? -1;
    if (envelope.awareness.sequence <= previousSequence) return;
    if (envelope.awareness.state) room.awareness.set(remoteClientId, envelope.awareness.state);
    else room.awareness.delete(remoteClientId);
    room.awarenessSequences.set(remoteClientId, envelope.awareness.sequence);
    room.lastActiveAt = now();
    broadcast(
      room,
      null,
      {
        protocol: LOBE_YJS_PROTOCOL,
        sender: remoteClientId,
        sequence: envelope.awareness.sequence,
        state: envelope.awareness.state,
        type: 'awareness',
        version: LOBE_YJS_PROTOCOL_VERSION,
      },
      'v1',
    );
  };

  const publishBackendUpdate = async (room, socket, message, update, revision) => {
    if (!roomBackend || !room.backend.scope) return;
    room.backend.sequence += 1;
    await roomBackend.publish(room.backend.scope, {
      kind: 'update',
      messageId: message.messageId,
      origin: roomBackend.instanceId,
      principal: createBackendPrincipal(socket.principal),
      revision,
      sender: socket.clientId,
      sequence: room.backend.sequence,
      update: message.update,
    });
  };

  const saveBackendRoomSnapshot = async (room) => {
    if (!roomBackend || !room.backend.scope || !room.backend.isOwner) return;
    const saved = await roomBackend.saveSnapshot(room.backend.scope, {
      ...(migrateLegacyBlockImagesInYjsDoc && room.backend.bootstrapRequired
        ? { bootstrapReady: room.backend.bootstrapReady }
        : {}),
      revision: room.revision,
      stateVector: new Uint8Array(encodeStateVector(room.doc)),
      update: new Uint8Array(encodeStateAsUpdate(room.doc)),
    });
    if (!saved) {
      room.backend.isOwner = false;
      throw new Error('Page collaboration room backend owner lease was lost.');
    }
  };

  const publishBackendAwareness = async (room, socket, sequence, state) => {
    if (!roomBackend || !room.backend.scope) return;
    room.backend.sequence += 1;
    await roomBackend.publish(room.backend.scope, {
      awareness: {
        clientId: socket.clientId,
        sequence,
        state,
      },
      kind: 'awareness',
      origin: roomBackend.instanceId,
      sequence: room.backend.sequence,
    });
  };

  const isBootstrapEligible = (socket) => socket.authenticated && socket.clientKind === 'browser';

  const getNextDeferredBootstrapClient = (room) => {
    for (const [candidate, clientId] of room.deferredSyncClients) {
      if (candidate.readyState === WebSocket.OPEN && isBootstrapEligible(candidate)) {
        return [candidate, clientId];
      }
      if (candidate.readyState === WebSocket.CLOSED) room.deferredSyncClients.delete(candidate);
    }
    return null;
  };

  const armBootstrapTimer = (room) => {
    if (room.hasReceivedUpdate || room.bootstrapTimer) return;

    // An Agent is deliberately not allowed to bootstrap an empty room. Without
    // a browser owner, however, leaving it in `deferredSyncClients` forever
    // would keep the worker's sync barrier and lease alive indefinitely. Fail
    // the deferred clients after the same bounded bootstrap window so their
    // durable request can retry or settle instead of hanging.
    if (!room.bootstrapOwner) {
      room.bootstrapTimer = setTimeout(() => {
        if (room.hasReceivedUpdate || room.bootstrapOwner) return;

        room.bootstrapTimer = null;
        const deferredClients = Array.from(room.deferredSyncClients.keys());
        room.deferredSyncClients.clear();
        for (const socket of deferredClients) {
          if (socket.readyState !== WebSocket.OPEN) continue;
          const message = 'A browser bootstrap owner did not join the room in time.';
          socket.send(
            JSON.stringify({
              code: 'bootstrap_timeout',
              fatal: true,
              message,
              protocol: LOBE_YJS_PROTOCOL,
              type: 'error',
              version: LOBE_YJS_PROTOCOL_VERSION,
            }),
          );
          socket.close(1013, message);
        }
      }, config.bootstrapTimeoutMs);
      room.bootstrapTimer.unref?.();
      return;
    }

    const owner = room.bootstrapOwner;
    const ownerClientId = room.bootstrapOwnerClientId;
    room.bootstrapTimer = setTimeout(() => {
      if (room.hasReceivedUpdate || room.bootstrapOwner !== owner) return;

      const nextOwner = getNextDeferredBootstrapClient(room);
      room.bootstrapTimer = null;

      // A solo owner is allowed to remain connected. A later deferred client
      // will re-arm this timer when it joins, so there is no polling timer or
      // repeated timeout log while a room is idle.
      if (!nextOwner) {
        if (room.deferredSyncClients.size > 0) armBootstrapTimer(room);
        return;
      }

      logRoomEvent('bootstrap.timeout', room, { clientId: ownerClientId });
      room.bootstrapOwner = null;
      room.bootstrapOwnerClientId = null;
      if (owner.readyState === WebSocket.OPEN) {
        owner.close(1013, 'Bootstrap owner timed out.');
      }

      const [nextSocket, nextClientId] = nextOwner;
      room.deferredSyncClients.delete(nextSocket);
      logRoomEvent('bootstrap.owner-promoted', room, {
        clientId: nextClientId,
        reason: 'timeout',
      });
      assignBootstrapOwner(room, nextSocket, nextClientId);
    }, config.bootstrapTimeoutMs);
    room.bootstrapTimer.unref?.();
  };

  const assignBootstrapOwner = (room, socket, clientId) => {
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    room.bootstrapOwner = socket;
    room.bootstrapOwnerClientId = clientId;
    logRoomEvent('bootstrap.owner-assigned', room, { clientId });
    sendRoomSync(room, socket, clientId, socket.syncRequestStateVector);
    armBootstrapTimer(room);
  };

  const armBackendBootstrapTimer = (room) => {
    if (!roomBackend || room.backend.bootstrapReady || room.backend.bootstrapTimer) return;
    room.backend.bootstrapTimer = setTimeout(() => {
      if (room.backend.bootstrapReady) return;
      room.backend.bootstrapTimer = null;
      const deferredClients = Array.from(room.deferredSyncClients.keys());
      room.deferredSyncClients.clear();
      for (const socket of deferredClients) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        const message = 'The collaboration room bootstrap is not ready.';
        if (socket.protocolMode === 'v1') {
          socket.send(
            JSON.stringify({
              code: 'bootstrap_timeout',
              fatal: true,
              message,
              protocol: LOBE_YJS_PROTOCOL,
              type: 'error',
              version: LOBE_YJS_PROTOCOL_VERSION,
            }),
          );
        }
        socket.close(1013, message);
      }
    }, config.bootstrapTimeoutMs);
    room.backend.bootstrapTimer.unref?.();
  };

  const flushDeferredSyncClients = (room) => {
    const clients = Array.from(room.deferredSyncClients);
    room.deferredSyncClients.clear();
    for (const [socket, clientId] of clients) {
      sendRoomSync(room, socket, clientId, socket.syncRequestStateVector);
    }
    return new Set(clients.map(([socket]) => socket));
  };

  const completeBootstrap = (room, socket, clientId) => {
    if (room.hasReceivedUpdate || room.bootstrapOwner !== socket) return null;
    room.hasReceivedUpdate = true;
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    room.bootstrapTimer = null;
    room.bootstrapOwner = null;
    room.bootstrapOwnerClientId = null;
    logRoomEvent('bootstrap.completed', room, {
      clientId,
      deferredClientCount: room.deferredSyncClients.size,
    });
    return flushDeferredSyncClients(room);
  };

  const promoteDeferredBootstrapClient = (room, reason) => {
    const nextOwner = getNextDeferredBootstrapClient(room);
    if (!nextOwner) return;
    const [nextSocket, nextClientId] = nextOwner;
    room.deferredSyncClients.delete(nextSocket);
    logRoomEvent('bootstrap.owner-promoted', room, { clientId: nextClientId, reason });
    assignBootstrapOwner(room, nextSocket, nextClientId);
  };

  const releaseBootstrapClient = (room, socket) => {
    room.deferredSyncClients.delete(socket);
    if (room.bootstrapOwner !== socket || room.hasReceivedUpdate) return;
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    room.bootstrapTimer = null;
    room.bootstrapOwner = null;
    room.bootstrapOwnerClientId = null;
    promoteDeferredBootstrapClient(room, 'disconnect');
    if (!room.bootstrapOwner && room.deferredSyncClients.size > 0) armBootstrapTimer(room);
  };

  const getExpiryMs = (value) => {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1_000_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const getAuthClaims = (result) => {
    if (!isRecord(result)) return {};
    const principal = isRecord(result.principal) ? result.principal : {};
    return { ...principal, ...result };
  };

  const getTicketReplayKey = (result) => {
    if (!isRecord(result)) return null;
    const principal = isRecord(result.principal) ? result.principal : {};
    const clientKind = result.clientKind ?? principal.clientKind;
    // Browser capabilities are reusable for reconnect unless the verifier
    // explicitly marks one single-use. Agent room tickets are single-use by
    // default and cannot opt out below.
    if (clientKind === 'browser' && result.singleUse !== true) return null;
    // DocumentRewriteRoomTicketService calls this opaque claim `nonce`; it is
    // a ticket identifier, not the per-connection hello nonce.
    const ticketId =
      result.ticketId ??
      result.jti ??
      result.nonce ??
      principal.ticketId ??
      principal.jti ??
      principal.nonce;
    if (ticketId === undefined || ticketId === null) return null;
    if (result.singleUse === false) return null;
    return `ticket:${String(ticketId)}`;
  };

  const reapConsumedTickets = () => {
    const nowValue = now();
    for (const [key, expiresAt] of consumedTicketKeys) {
      if (expiresAt !== null && expiresAt <= nowValue) consumedTicketKeys.delete(key);
    }
  };

  const canRememberTicket = (replayKey) => {
    reapConsumedTickets();
    return (
      consumedTicketKeys.has(replayKey) || consumedTicketKeys.size < config.maxProcessedMessageIds
    );
  };

  const validateAuthResult = (result, message, roomId) => {
    reapConsumedTickets();
    const accepted =
      result === true ||
      (isRecord(result) &&
        result.allowed !== false &&
        (result.allowed === true ||
          result.principal ||
          result.clientId !== undefined ||
          result.roomId !== undefined));
    if (!accepted) return { accepted: false, code: 'unauthorized' };

    const claims = getAuthClaims(result);
    const expiryClaim = claims.expiresAt ?? claims.exp;
    const missingBoundClaims =
      result === true ||
      (claims.ticketId === undefined && claims.jti === undefined && claims.nonce === undefined) ||
      expiryClaim === undefined ||
      typeof claims.roomId !== 'string' ||
      typeof claims.documentId !== 'string' ||
      typeof claims.clientKind !== 'string';
    if (usesFormalTicketVerifier && missingBoundClaims) {
      return { accepted: false, code: 'unbound_ticket' };
    }
    if (
      requireAgentTicketClaims &&
      usesFormalTicketVerifier &&
      message.clientKind === 'agent' &&
      (typeof claims.requestId !== 'string' || result.singleUse === false)
    ) {
      return { accepted: false, code: 'unbound_ticket' };
    }
    if (claims.roomId !== undefined && claims.roomId !== roomId) {
      return { accepted: false, code: 'room_mismatch' };
    }
    if (
      claims.documentId !== undefined &&
      (typeof message.documentId !== 'string' || claims.documentId !== message.documentId)
    ) {
      return { accepted: false, code: 'document_mismatch' };
    }
    if (
      claims.requestId !== undefined &&
      (typeof message.requestId !== 'string' || claims.requestId !== message.requestId)
    ) {
      return { accepted: false, code: 'request_mismatch' };
    }
    if (claims.clientKind !== undefined && claims.clientKind !== message.clientKind) {
      return { accepted: false, code: 'client_kind_mismatch' };
    }
    if (expiryClaim !== undefined) {
      const expiresAt = getExpiryMs(expiryClaim);
      if (expiresAt === null || expiresAt <= now()) {
        return { accepted: false, code: 'ticket_expired' };
      }
    }

    const replayKey = getTicketReplayKey(result);
    if (replayKey && (consumedTicketKeys.has(replayKey) || inFlightTicketKeys.has(replayKey))) {
      return { accepted: false, code: 'ticket_replayed' };
    }
    const expiresAt = getExpiryMs(expiryClaim);
    return { accepted: true, claims, expiresAt, replayKey };
  };

  /**
   * Reserve room presence at authentication time, not on raw TCP connect.
   * Counting auth-in-flight sockets closes the small async verifier race in
   * which six Agent tickets could otherwise all observe five or fewer clients.
   * The reservation is local to this room instance; durable request capacity
   * remains the cross-process database guard.
   */
  const roomClientLimit = (clientKind) =>
    clientKind === 'browser' ? config.maxBrowserClients : config.maxAgentClients;

  const roomClientCount = (room, clientKind, excludedSocket) =>
    Array.from(room.clients).filter(
      (candidate) =>
        candidate !== excludedSocket &&
        candidate.readyState === WebSocket.OPEN &&
        ((candidate.authenticated && candidate.clientKind === clientKind) ||
          (candidate.authInFlight && candidate.pendingClientKind === clientKind)),
    ).length;

  const roomClientLimitCode = (clientKind) =>
    clientKind === 'browser' ? 'browser_client_limit' : 'agent_client_limit';

  const roomClientLimitMessage = (clientKind) =>
    clientKind === 'browser'
      ? `A collaboration room allows at most ${config.maxBrowserClients} browser client.`
      : `A collaboration room allows at most ${config.maxAgentClients} Agent clients.`;

  const releasePresenceReservation = (socket, room) => {
    const reservation = socket.presenceReservation;
    if (!reservation) return;
    socket.presenceReservation = null;
    if (!roomBackend || typeof roomBackend.releaseClient !== 'function') return;
    void Promise.resolve(
      roomBackend.releaseClient(reservation.scope, {
        clientId: reservation.clientId,
        clientKind: reservation.clientKind,
      }),
    ).catch((error) => {
      logRoomEvent('backend.presence.release-failed', room, {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const createRateState = () => ({
    awareness: { bytes: 0, count: 0, startedAt: now() },
    update: { bytes: 0, count: 0, startedAt: now() },
  });

  const consumeRate = (socket, kind, bytes) => {
    const bucket = socket.rateState[kind];
    const nowValue = now();
    if (nowValue - bucket.startedAt >= config.rateLimitWindowMs) {
      bucket.bytes = 0;
      bucket.count = 0;
      bucket.startedAt = nowValue;
    }

    const maxCount = kind === 'update' ? config.maxUpdatesPerSecond : config.maxAwarenessPerSecond;
    const maxBytes =
      kind === 'update' ? config.maxUpdateBytesPerSecond : config.maxAwarenessBytesPerSecond;
    if (bucket.count + 1 > maxCount || bucket.bytes + bytes > maxBytes) return false;
    bucket.count += 1;
    bucket.bytes += bytes;
    return true;
  };

  const rejectV1 = (socket, sendV1Error, code, message, closeCode = 1008) => {
    sendV1Error(code, message);
    socket.close(closeCode, message);
  };

  const handleSocketConnection = (socket, request) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const roomMatch = url.pathname.match(/^\/collaboration\/([^/]+)$/);
    if (!roomMatch) {
      socket.close(1008, 'Invalid collaboration room.');
      return;
    }

    let id;
    try {
      id = decodeURIComponent(roomMatch[1]);
    } catch {
      socket.close(1008, 'Invalid collaboration room.');
      return;
    }
    const requestedClientId = Number(url.searchParams.get('clientId'));
    let clientId = Number.isSafeInteger(requestedClientId) ? requestedClientId : Date.now();
    const requestedProtocol = url.searchParams.get('protocol');
    const protocolMode = requestedProtocol === LOBE_YJS_PROTOCOL ? 'v1' : 'legacy';
    const room = getRoom(id);

    socket.isAlive = true;
    socket.authenticated = protocolMode === 'legacy';
    socket.authInFlight = false;
    socket.pendingClientKind = protocolMode === 'legacy' ? 'browser' : null;
    socket.clientId = clientId;
    socket.clientKind = protocolMode === 'legacy' ? 'browser' : null;
    socket.hasSentInitialSync = false;
    socket.lastAwarenessSequence = -1;
    socket.rateState = createRateState();
    socket.protocolMode = protocolMode;
    socket.principal = null;
    socket.presenceReservation = null;
    socket.authExpiresAt = null;
    socket.authExpiryTimer = null;
    socket.helloNonce = crypto.randomUUID();
    socket.syncRequestStateVector = undefined;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
    room.clients.add(socket);
    room.lastActiveAt = now();
    room.lastEmptyAt = null;
    logRoomEvent('client.connected', room, { clientId });
    socket.on('error', (error) => {
      logRoomEvent('client.error', room, { clientId, message: error.message });
    });

    if (protocolMode === 'v1') {
      if (!config.enableV1Protocol) {
        socket.close(1008, 'The lobe-yjs-v1 collaboration protocol is disabled.');
        return;
      }

      socket.send(
        JSON.stringify({
          nonce: socket.helloNonce,
          protocol: LOBE_YJS_PROTOCOL,
          roomId: id,
          type: 'hello',
          version: LOBE_YJS_PROTOCOL_VERSION,
        }),
      );

      const sendV1Error = (code, message) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            code,
            fatal: true,
            message,
            protocol: LOBE_YJS_PROTOCOL,
            type: 'error',
            version: LOBE_YJS_PROTOCOL_VERSION,
          }),
        );
      };

      socket.on('message', (rawMessage) => {
        let message;
        try {
          message = JSON.parse(String(rawMessage));
        } catch {
          socket.close(1003, 'Invalid JSON message.');
          return;
        }

        if (!isV1MessageValid(message)) {
          sendV1Error('invalid_message', 'Invalid lobe-yjs-v1 message.');
          socket.close(1003, 'Invalid lobe-yjs-v1 message.');
          return;
        }

        if (message.type === 'auth') {
          if (
            socket.authenticated ||
            socket.authInFlight ||
            Object.hasOwn(message, 'sender') ||
            message.nonce !== socket.helloNonce
          ) {
            sendV1Error('invalid_auth', 'Invalid collaboration auth.');
            socket.close(1008, 'Invalid collaboration auth.');
            return;
          }

          // Keep the requested kind visible while asynchronous ticket/Redis
          // verification is running so concurrent auth frames cannot overbook
          // the room's browser/Agent presence budget.
          socket.pendingClientKind = message.clientKind;

          let authResult;
          let verifierFailureCode = null;
          try {
            authResult = config.authValidator({
              clientId: message.clientId,
              clientKind: message.clientKind,
              documentId: message.documentId,
              requestId: message.requestId,
              roomId: id,
              ticket: message.ticket,
            });
          } catch (error) {
            const verifierCode = isRecord(error) ? error.code : error?.code;
            if (typeof verifierCode === 'string') {
              if (verifierCode.includes('EXPIRED')) verifierFailureCode = 'ticket_expired';
              else if (verifierCode.includes('REPLAYED')) verifierFailureCode = 'ticket_replayed';
            }
            authResult = false;
          }

          const finishAuth = async (result) => {
            const validation = validateAuthResult(result, message, id);
            if (!validation.accepted) {
              socket.authInFlight = false;
              socket.pendingClientKind = null;
              const validationCode = verifierFailureCode || validation.code;
              const errorMessage =
                validationCode === 'ticket_expired'
                  ? 'Collaboration ticket has expired.'
                  : validationCode === 'ticket_replayed'
                    ? 'Collaboration ticket has already been used.'
                    : 'Collaboration authentication was rejected.';
              rejectV1(socket, sendV1Error, validationCode, errorMessage);
              return;
            }

            const authenticatedKind =
              validation.claims.clientKind === 'browser' || validation.claims.clientKind === 'agent'
                ? validation.claims.clientKind
                : message.clientKind;
            if (
              roomClientCount(room, authenticatedKind, socket) >= roomClientLimit(authenticatedKind)
            ) {
              socket.authInFlight = false;
              socket.pendingClientKind = null;
              // Remove the rejected socket from presence immediately. The
              // WebSocket `close` event is asynchronous, and leaving it in
              // room.clients would make diagnostics and a simultaneous auth
              // attempt observe a phantom client.
              room.clients.delete(socket);
              rejectV1(
                socket,
                sendV1Error,
                roomClientLimitCode(authenticatedKind),
                roomClientLimitMessage(authenticatedKind),
              );
              logRoomEvent('client.auth-rejected', room, {
                clientKind: authenticatedKind,
                reason: roomClientLimitCode(authenticatedKind),
              });
              return;
            }

            if (validation.replayKey && !canRememberTicket(validation.replayKey)) {
              rejectV1(
                socket,
                sendV1Error,
                'replay_store_full',
                'Collaboration ticket replay store is full.',
              );
              return;
            }

            // Redis-backed deployments may have multiple relay instances for
            // one room. Reserve the authenticated presence in the shared
            // backend before consuming a single-use ticket; the local count
            // above protects this process while this async reservation runs.
            if (roomBackend && typeof roomBackend.reserveClient === 'function') {
              try {
                await roomBackendReady;
                if (typeof roomBackend.healthy === 'function' && !roomBackend.healthy()) {
                  throw new Error('Page collaboration room backend is unavailable.');
                }
                const presenceScope = createBackendScope(room, {
                  documentId: validation.claims.documentId ?? message.documentId ?? id,
                  roomId: validation.claims.roomId ?? id,
                  userId: validation.claims.userId ?? null,
                  workspaceId: validation.claims.workspaceId ?? null,
                });
                const reservation = await roomBackend.reserveClient(presenceScope, {
                  clientId: socket.helloNonce,
                  clientKind: authenticatedKind,
                  expiresAt: validation.expiresAt,
                  maxClients: roomClientLimit(authenticatedKind),
                });
                if (!reservation.accepted) {
                  socket.authInFlight = false;
                  socket.pendingClientKind = null;
                  room.clients.delete(socket);
                  rejectV1(
                    socket,
                    sendV1Error,
                    roomClientLimitCode(authenticatedKind),
                    roomClientLimitMessage(authenticatedKind),
                  );
                  logRoomEvent('client.auth-rejected', room, {
                    clientKind: authenticatedKind,
                    reason: roomClientLimitCode(authenticatedKind),
                    scope: 'backend',
                  });
                  return;
                }
                socket.presenceReservation = {
                  clientId: socket.helloNonce,
                  clientKind: authenticatedKind,
                  scope: presenceScope,
                };
              } catch (error) {
                socket.authInFlight = false;
                socket.pendingClientKind = null;
                room.clients.delete(socket);
                rejectV1(
                  socket,
                  sendV1Error,
                  'backend_unavailable',
                  'The collaboration room backend is temporarily unavailable.',
                  1013,
                );
                logRoomEvent('backend.presence.failed', room, {
                  message: error instanceof Error ? error.message : String(error),
                });
                return;
              }
            }

            if (validation.replayKey) {
              inFlightTicketKeys.set(validation.replayKey, validation.expiresAt ?? null);
              try {
                if (roomBackend) {
                  await roomBackendReady;
                  if (typeof roomBackend.healthy === 'function' && !roomBackend.healthy()) {
                    throw new Error('Page collaboration room backend is unavailable.');
                  }
                  const reservation = await roomBackend.reserveReplay(
                    validation.replayKey,
                    validation.expiresAt ?? null,
                  );
                  if (!reservation.accepted) {
                    inFlightTicketKeys.delete(validation.replayKey);
                    const code =
                      reservation.reason === 'full' ? 'replay_store_full' : 'ticket_replayed';
                    rejectV1(
                      socket,
                      sendV1Error,
                      code,
                      code === 'replay_store_full'
                        ? 'Collaboration ticket replay store is full.'
                        : 'Collaboration ticket has already been used.',
                    );
                    return;
                  }
                }
                consumedTicketKeys.set(validation.replayKey, validation.expiresAt ?? null);
                reapConsumedTickets();
              } catch (error) {
                inFlightTicketKeys.delete(validation.replayKey);
                rejectV1(
                  socket,
                  sendV1Error,
                  'backend_unavailable',
                  'The collaboration room backend is temporarily unavailable.',
                  1013,
                );
                logRoomEvent('backend.replay.failed', room, {
                  message: error instanceof Error ? error.message : String(error),
                });
                return;
              } finally {
                inFlightTicketKeys.delete(validation.replayKey);
              }
            } else if (roomBackend) {
              try {
                await roomBackendReady;
                if (typeof roomBackend.healthy === 'function' && !roomBackend.healthy()) {
                  throw new Error('Page collaboration room backend is unavailable.');
                }
              } catch (error) {
                rejectV1(
                  socket,
                  sendV1Error,
                  'backend_unavailable',
                  'The collaboration room backend is temporarily unavailable.',
                  1013,
                );
                logRoomEvent('backend.auth.failed', room, {
                  message: error instanceof Error ? error.message : String(error),
                });
                return;
              }
            }

            const claims = validation.claims;

            // The URL/auth frame clientId is a Yjs-local identity supplied by
            // the client, not an authenticated server identity. Always assign
            // the relay identity here so a client cannot collide with another
            // connection's awareness/update sender id.
            const assignedClientId = nextServerClientId++;
            clientId = assignedClientId;
            socket.clientId = assignedClientId;
            socket.clientKind = authenticatedKind;
            const principal =
              isRecord(result) && isRecord(result.principal) ? result.principal : {};
            socket.principal = {
              ...principal,
              authoritative: usesFormalTicketVerifier,
              clientId: assignedClientId,
              clientKind: socket.clientKind,
              documentId: claims.documentId ?? message.documentId ?? id,
              requestId: claims.requestId ?? message.requestId ?? null,
              roomId: claims.roomId ?? id,
            };
            socket.authenticated = true;
            socket.authInFlight = false;
            socket.pendingClientKind = null;
            socket.authExpiresAt = validation.expiresAt ?? null;
            if (socket.authExpiryTimer) clearTimeout(socket.authExpiryTimer);
            if (socket.authExpiresAt !== null) {
              const message = 'Collaboration ticket has expired.';
              socket.authExpiryTimer = setTimeout(
                () => {
                  if (
                    socket.readyState !== WebSocket.OPEN ||
                    !socket.authenticated ||
                    socket.authExpiresAt === null ||
                    socket.authExpiresAt > now()
                  ) {
                    return;
                  }
                  sendV1Error('ticket_expired', message);
                  socket.close(1008, message);
                },
                Math.max(0, socket.authExpiresAt - now()),
              );
              socket.authExpiryTimer.unref?.();
            }
            room.lastActiveAt = now();
            socket.send(
              JSON.stringify({
                clientId: assignedClientId,
                protocol: LOBE_YJS_PROTOCOL,
                roomId: id,
                type: 'auth-ok',
                version: LOBE_YJS_PROTOCOL_VERSION,
              }),
            );
            logRoomEvent('client.authenticated', room, {
              clientId: assignedClientId,
              clientKind: socket.clientKind,
              requestId: socket.principal.requestId,
            });
          };

          socket.authInFlight = true;
          if (authResult && typeof authResult.then === 'function') {
            authResult.then(finishAuth).catch((error) => {
              const verifierCode = isRecord(error) ? error.code : error?.code;
              if (typeof verifierCode === 'string') {
                if (verifierCode.includes('EXPIRED')) verifierFailureCode = 'ticket_expired';
                else if (verifierCode.includes('REPLAYED')) verifierFailureCode = 'ticket_replayed';
              }
              finishAuth(false);
            });
          } else {
            finishAuth(authResult);
          }
          return;
        }

        if (!socket.authenticated || socket.authInFlight) {
          sendV1Error('unauthorized', 'Authenticate before using the collaboration room.');
          socket.close(1008, 'Authentication required.');
          return;
        }

        if (socket.authExpiresAt !== null && socket.authExpiresAt <= now()) {
          rejectV1(socket, sendV1Error, 'ticket_expired', 'Collaboration ticket has expired.');
          return;
        }

        if (Object.hasOwn(message, 'sender')) {
          sendV1Error('sender_forbidden', 'Clients must not provide a sender identity.');
          socket.close(1008, 'Sender identity is server assigned.');
          return;
        }

        if (message.type === 'sync-request') {
          void (async () => {
            try {
              if (roomBackend) {
                // A fresh sync request is an explicit retry boundary. Once
                // the bounded owner attempts are exhausted, do not strand a
                // room forever behind the retry counter while still allowing
                // the current in-flight candidate to finish normally.
                if (
                  room.backend.bootstrapRequired &&
                  !room.backend.bootstrapReady &&
                  !room.backend.bootstrapPromise
                ) {
                  room.backend.bootstrapRetryCount = 0;
                }
                await ensureBackendRoom(room, socket.principal);
              }
              socket.syncRequestStateVector = decodeUpdate(
                message.stateVector,
                config.maxUpdateBytes,
              );
              room.lastActiveAt = now();

              if (room.hasReceivedUpdate) {
                sendRoomSync(room, socket, clientId, socket.syncRequestStateVector);
              } else if (
                roomBackend &&
                room.backend.bootstrapRequired &&
                !room.backend.bootstrapReady
              ) {
                room.deferredSyncClients.set(socket, clientId);
                logRoomEvent('sync.deferred', room, {
                  clientId,
                  reason: 'backend-bootstrap',
                });
                armBackendBootstrapTimer(room);
              } else if (!isBootstrapEligible(socket)) {
                room.deferredSyncClients.set(socket, clientId);
                logRoomEvent('sync.deferred', room, {
                  clientId,
                  reason: 'agent-awaiting-browser-bootstrap',
                });
                armBootstrapTimer(room);
              } else if (!room.bootstrapOwner) {
                room.deferredSyncClients.delete(socket);
                assignBootstrapOwner(room, socket, clientId);
              } else if (room.bootstrapOwner === socket) {
                sendRoomSync(room, socket, clientId, socket.syncRequestStateVector);
              } else {
                room.deferredSyncClients.set(socket, clientId);
                logRoomEvent('sync.deferred', room, { clientId });
              }
            } catch (error) {
              const backendFailure =
                roomBackend && !String(error?.message || '').includes('state vector');
              sendV1Error(
                backendFailure ? 'backend_unavailable' : 'invalid_state_vector',
                backendFailure
                  ? 'The collaboration room backend is temporarily unavailable.'
                  : 'Invalid Yjs state vector.',
              );
              socket.close(backendFailure ? 1013 : 1003, 'Collaboration sync failed.');
            }
          })();
          return;
        }

        if (message.type === 'update') {
          const processUpdate = async () => {
            if (roomBackend) {
              await ensureBackendRoom(room, socket.principal);
              if (typeof roomBackend.healthy === 'function' && !roomBackend.healthy()) {
                rejectV1(
                  socket,
                  sendV1Error,
                  'backend_unavailable',
                  'The collaboration room backend is temporarily unavailable.',
                  1013,
                );
                return;
              }
              if (room.backend.bootstrapRequired && !room.backend.bootstrapReady) {
                rejectV1(
                  socket,
                  sendV1Error,
                  'bootstrap_pending',
                  'The collaboration room bootstrap is still being prepared.',
                );
                return;
              }
            }
            if (!room.hasReceivedUpdate && room.bootstrapOwner !== socket) {
              rejectV1(
                socket,
                sendV1Error,
                'bootstrap_owner_required',
                'Only the authorized browser bootstrap owner may publish the first room update.',
              );
              return;
            }
            if (socket.principal && socket.principal.canWrite === false) {
              rejectV1(
                socket,
                sendV1Error,
                'read_only',
                'This collaboration capability is read-only.',
              );
              return;
            }

            if (!consumeRate(socket, 'update', Buffer.byteLength(String(rawMessage)))) {
              rejectV1(
                socket,
                sendV1Error,
                'rate_limited',
                'Collaboration update rate limit exceeded.',
              );
              return;
            }

            if (room.processedMessageIds.has(message.messageId)) {
              socket.send(
                JSON.stringify({
                  messageId: message.messageId,
                  protocol: LOBE_YJS_PROTOCOL,
                  type: 'update-ack',
                  version: LOBE_YJS_PROTOCOL_VERSION,
                }),
              );
              return;
            }

            try {
              const update = decodeUpdate(message.update, config.maxUpdateBytes);
              let previewChanged = null;
              if (roomBackend) {
                // Never mutate the live room before the durable relay accepts
                // the write. A failed Redis revision/publish must not leak an
                // unacknowledged update through a later local sync.
                const preview = new Doc();
                try {
                  applyUpdate(preview, encodeStateAsUpdate(room.doc), room.backend);
                  previewChanged = applyUpdateAndDetectChange(preview, update, room.backend);
                } finally {
                  preview.destroy();
                }
                if (previewChanged) {
                  room.revision = await roomBackend.allocateRevision(room.backend.scope);
                }
                await publishBackendUpdate(room, socket, message, update, room.revision);
              }

              const changed = applyUpdateAndDetectChange(room.doc, update, socket);
              room.lastActiveAt = now();
              const bootstrapClients = completeBootstrap(room, socket, clientId);
              const stateVector = encodeStateVector(room.doc);
              if (changed) {
                if (!roomBackend) room.revision += 1;
                room.lastUpdatePrincipal = socket.principal;
              }
              if (roomBackend && changed !== previewChanged) {
                throw new Error('Page collaboration backend preview diverged from the live room.');
              }
              if (changed) await saveBackendRoomSnapshot(room);
              if (changed && (!roomBackend || room.backend.isOwner)) {
                scheduleRoomPersistence(room, {
                  documentId: socket.principal?.documentId || room.id,
                  messageId: message.messageId,
                  principal: socket.principal,
                  requestId: socket.principal?.requestId || null,
                  stateVector,
                  updateBytes: update.byteLength,
                });
              }
              rememberProcessedMessageId(room, message.messageId);
              const outbound = {
                messageId: message.messageId,
                protocol: LOBE_YJS_PROTOCOL,
                revision: room.revision,
                sender: clientId,
                type: 'update',
                update: message.update,
                version: LOBE_YJS_PROTOCOL_VERSION,
              };
              logRoomEvent('update.applied', room, {
                clientId,
                changed,
                messageId: message.messageId,
                revision: room.revision,
                updateBytes: update.byteLength,
              });
              if (changed) broadcast(room, socket, outbound, 'v1', bootstrapClients);
              socket.send(
                JSON.stringify({
                  messageId: message.messageId,
                  protocol: LOBE_YJS_PROTOCOL,
                  type: 'update-ack',
                  version: LOBE_YJS_PROTOCOL_VERSION,
                }),
              );
            } catch (error) {
              const backendFailure =
                roomBackend &&
                (error?.message?.includes('backend') || error?.message?.includes('Redis'));
              sendV1Error(
                backendFailure ? 'backend_unavailable' : 'invalid_update',
                backendFailure
                  ? 'The collaboration room backend is temporarily unavailable.'
                  : 'Invalid Yjs update.',
              );
              socket.close(backendFailure ? 1013 : 1003, 'Collaboration update failed.');
            }
          };
          const updatePromise = roomBackend
            ? enqueueBackendOperation(room, processUpdate)
            : processUpdate();
          void updatePromise.catch((error) => {
            failBackendRoom(room, error);
          });
          return;
        }

        if (message.type === 'awareness') {
          const awarenessBytes = Buffer.byteLength(String(rawMessage));
          if (
            awarenessBytes > config.maxAwarenessBytes ||
            !consumeRate(socket, 'awareness', awarenessBytes)
          ) {
            rejectV1(
              socket,
              sendV1Error,
              awarenessBytes > config.maxAwarenessBytes ? 'awareness_too_large' : 'rate_limited',
              awarenessBytes > config.maxAwarenessBytes
                ? 'Collaboration awareness payload is too large.'
                : 'Collaboration awareness rate limit exceeded.',
            );
            return;
          }
          if (message.sequence <= socket.lastAwarenessSequence) return;
          socket.lastAwarenessSequence = message.sequence;
          if (message.state) room.awareness.set(clientId, message.state);
          else room.awareness.delete(clientId);
          room.awarenessSequences.set(clientId, message.sequence);
          room.lastActiveAt = now();
          broadcast(
            room,
            socket,
            {
              protocol: LOBE_YJS_PROTOCOL,
              sender: clientId,
              sequence: message.sequence,
              state: message.state,
              type: 'awareness',
              version: LOBE_YJS_PROTOCOL_VERSION,
            },
            'v1',
          );
          if (roomBackend && !closing) {
            void publishBackendAwareness(room, socket, message.sequence, message.state).catch(
              (error) => failBackendRoom(room, error),
            );
          }
        }
      });

      socket.on('close', () => {
        if (socket.authExpiryTimer) clearTimeout(socket.authExpiryTimer);
        socket.authExpiryTimer = null;
        releasePresenceReservation(socket, room);
        releaseBootstrapClient(room, socket);
        room.clients.delete(socket);
        room.awareness.delete(clientId);
        room.awarenessSequences.delete(clientId);
        if (socket.authenticated) {
          if (roomBackend && !closing) {
            void publishBackendAwareness(
              room,
              socket,
              socket.lastAwarenessSequence + 1,
              null,
            ).catch((error) => failBackendRoom(room, error));
          }
          broadcast(
            room,
            socket,
            {
              protocol: LOBE_YJS_PROTOCOL,
              sender: clientId,
              sequence: socket.lastAwarenessSequence + 1,
              state: null,
              type: 'awareness',
              version: LOBE_YJS_PROTOCOL_VERSION,
            },
            'v1',
          );
        }
        if (room.clients.size === 0) {
          room.awareness.clear();
          room.awarenessSequences.clear();
          room.lastEmptyAt = now();
        }
        logRoomEvent('client.disconnected', room, { clientId });
      });
      return;
    }

    if (!config.allowLegacyProtocol) {
      socket.close(1008, 'The legacy collaboration protocol is disabled.');
      return;
    }

    // Legacy clients do not send a v1 auth frame. Keep this compatibility path
    // scoped to the explicitly enabled local protocol and still attach a
    // server-owned principal for persistence metadata.
    socket.principal = {
      clientId,
      clientKind: 'browser',
      documentId: id,
      requestId: null,
      roomId: id,
    };

    // An empty Y.Doc may be bootstrapped by exactly one browser. Simultaneous
    // clients wait for its first update so a database snapshot is not inserted
    // once per connection.
    if (!room.hasReceivedUpdate && room.bootstrapOwner) {
      room.deferredSyncClients.set(socket, clientId);
      logRoomEvent('sync.deferred', room, { clientId });
      armBootstrapTimer(room);
    } else if (!room.hasReceivedUpdate) {
      assignBootstrapOwner(room, socket, clientId);
    } else {
      sendRoomSync(room, socket, clientId);
    }

    socket.on('message', (rawMessage) => {
      let message;
      try {
        message = JSON.parse(String(rawMessage));
      } catch {
        socket.close(1003, 'Invalid JSON message.');
        return;
      }

      if (message.type === 'update') {
        const updateMessageBytes = Buffer.byteLength(String(rawMessage));
        if (
          updateMessageBytes > config.maxMessageBytes ||
          !consumeRate(socket, 'update', updateMessageBytes)
        ) {
          socket.close(1008, 'Collaboration update rate limit exceeded.');
          return;
        }
        if (!room.hasReceivedUpdate && room.bootstrapOwner !== socket) {
          socket.close(1008, 'Bootstrap owner required.');
          return;
        }
        try {
          const update = decodeUpdate(message.update, config.maxUpdateBytes);
          const changed = applyUpdateAndDetectChange(room.doc, update, socket);
          room.lastActiveAt = now();
          const bootstrapClients = completeBootstrap(room, socket, clientId);
          const stateVector = encodeStateVector(room.doc);
          if (changed) {
            room.revision += 1;
            room.lastUpdatePrincipal = socket.principal;
          }
          if (changed) {
            scheduleRoomPersistence(room, {
              documentId: room.id,
              messageId: message.messageId,
              principal: socket.principal,
              requestId: socket.principal?.requestId || null,
              stateVector,
              updateBytes: update.byteLength,
            });
          }
          logRoomEvent('update.applied', room, {
            changed,
            clientId,
            revision: room.revision,
            updateBytes: update.byteLength,
          });
          if (changed) {
            broadcast(
              room,
              socket,
              { ...message, revision: room.revision, sender: clientId },
              undefined,
              bootstrapClients,
            );
          }
        } catch {
          logRoomEvent('update.rejected', room, { clientId });
          socket.close(1003, 'Invalid Yjs update.');
        }
        return;
      }

      if (message.type === 'awareness') {
        const awarenessBytes = Buffer.byteLength(String(rawMessage));
        if (
          awarenessBytes > config.maxAwarenessBytes ||
          !consumeRate(socket, 'awareness', awarenessBytes)
        ) {
          socket.close(1008, 'Collaboration awareness limit exceeded.');
          return;
        }
        if (message.state) room.awareness.set(clientId, message.state);
        else room.awareness.delete(clientId);
        logRoomEvent('awareness.updated', room, { clientId });
        broadcast(room, socket, { ...message, sender: clientId });
      }
    });

    socket.on('close', () => {
      releaseBootstrapClient(room, socket);
      room.clients.delete(socket);
      room.awareness.delete(clientId);
      broadcast(room, socket, { sender: clientId, state: null, type: 'awareness' });
      if (room.clients.size === 0) {
        room.awareness.clear();
        room.lastEmptyAt = now();
      }
      logRoomEvent('client.disconnected', room, { clientId });
    });
  };

  const flushRoom = (roomId, reason = 'manual') => {
    const room = rooms.get(roomId);
    if (!room) return Promise.resolve(null);
    return flushRoomPersistence(room, reason);
  };

  const flushAllRooms = async (reason = 'manual') => {
    const flushes = Array.from(rooms.values()).map((room) =>
      flushRoomPersistence(room, reason).catch((error) => {
        logRoomEvent('persistence.flush-failed', room, {
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }),
    );
    return Promise.all(flushes);
  };

  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') return sendJson(response, 204);
    if (request.method === 'GET' && request.url === '/health') {
      const healthy = !roomBackend || roomBackend.healthy();
      return sendJson(response, healthy ? 200 : 503, { ok: healthy });
    }
    if (request.method === 'GET' && request.url === '/metrics') {
      return sendJson(response, 200, getServerMetrics());
    }
    if (request.method === 'GET' && request.url === '/rooms' && config.exposeRoomDiagnostics) {
      return sendJson(response, 200, { rooms: getRoomDiagnostics() });
    }
    return sendJson(response, 404, { error: 'Not found' });
  });
  const wsServer = new WebSocketServer({ maxPayload: config.maxMessageBytes, noServer: true });
  server.on('upgrade', (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, (websocket) => {
      handleSocketConnection(websocket, request);
    });
  });

  const cleanupTimer = setInterval(cleanupIdleRooms, config.cleanupIntervalMs);
  cleanupTimer.unref();
  timers.add(cleanupTimer);
  const heartbeatTimer = setInterval(() => {
    for (const socket of wsServer.clients) {
      if (socket.isAlive === false) socket.terminate();
      else {
        socket.isAlive = false;
        socket.ping();
      }
    }
  }, config.heartbeatIntervalMs);
  heartbeatTimer.unref();
  timers.add(heartbeatTimer);

  let closePromise = null;
  let closing = false;

  return {
    close: () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        closing = true;
        for (const timer of timers) clearInterval(timer);
        await flushAllRooms('server-close');
        for (const socket of wsServer.clients) socket.terminate();
        await Promise.all(
          Array.from(rooms.values()).map((room) => drainBackendRoom(room, 'server-close')),
        );
        for (const room of rooms.values()) {
          if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
          if (room.persistence.debounceTimer) clearTimeout(room.persistence.debounceTimer);
          room.doc.destroy();
        }
        rooms.clear();
        await roomBackend?.close?.();
        if (server.listening) {
          await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      })();
      return closePromise;
    },
    flushAllRooms,
    flushRoom,
    getRoomDiagnostics,
    getServerMetrics,
    listen: (port = 12_345, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      }),
    rooms,
    cleanupIdleRooms,
  };
}

if (require.main === module) {
  const instance = createCollaborationServer();
  const port = Number(process.env.PAGE_COLLABORATION_PORT || 12_345);
  const host = process.env.PAGE_COLLABORATION_HOST || '127.0.0.1';
  instance.listen(port, host).then(() => {
    console.info(`[page-collaboration] listening on http://${host}:${port}`);
  });
}

const getYjsDocConstructorForTests = () => Doc;

module.exports = { createCollaborationServer, getYjsDocConstructorForTests };
