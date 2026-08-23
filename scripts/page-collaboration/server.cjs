const http = require('node:http');

const { WebSocket, WebSocketServer } = require('ws');
const { Doc, applyUpdate, encodeStateAsUpdate } = require('yjs');

const DEFAULTS = {
  bootstrapTimeoutMs: 10_000,
  cleanupIntervalMs: 60_000,
  heartbeatIntervalMs: 30_000,
  maxIdleRooms: 20,
  maxMessageBytes: 2 * 1024 * 1024,
  roomIdleTtlMs: 30 * 60 * 1000,
};

const encodeUpdate = (update) => Buffer.from(update).toString('base64');
const decodeUpdate = (update) => new Uint8Array(Buffer.from(update, 'base64'));

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
  const config = {
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
    roomIdleTtlMs: Number(
      options.roomIdleTtlMs ??
        process.env.PAGE_COLLABORATION_ROOM_IDLE_TTL_MS ??
        DEFAULTS.roomIdleTtlMs,
    ),
  };
  const logger = options.logger || console;
  const now = options.now || Date.now;
  const rooms = new Map();
  const timers = new Set();

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

  const getRoom = (id) => {
    let room = rooms.get(id);
    if (room) return room;

    const nowValue = now();
    room = {
      awareness: new Map(),
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
    };
    rooms.set(id, room);
    logRoomEvent('room.created', room);
    return room;
  };

  const getRoomDiagnostics = () =>
    Array.from(rooms.values()).map((room) => ({
      awarenessCount: room.awareness.size,
      bootstrapClientId: room.bootstrapOwnerClientId,
      clientCount: room.clients.size,
      deferredSyncClientCount: room.deferredSyncClients.size,
      id: room.id,
      lastActiveAt: new Date(room.lastActiveAt).toISOString(),
      lastEmptyAt: room.lastEmptyAt ? new Date(room.lastEmptyAt).toISOString() : null,
      status: room.clients.size > 0 ? 'active' : 'idle',
    }));

  const evictRoom = (room, reason) => {
    logRoomEvent('room.evicted', room, { reason });
    room.doc.destroy();
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    room.awareness.clear();
    room.deferredSyncClients.clear();
    rooms.delete(room.id);
  };

  const cleanupIdleRooms = () => {
    const nowValue = now();
    let idleRooms = Array.from(rooms.values())
      .filter((room) => room.clients.size === 0)
      .sort((a, b) => a.lastEmptyAt - b.lastEmptyAt);

    for (const room of idleRooms) {
      if (nowValue - room.lastEmptyAt >= config.roomIdleTtlMs) evictRoom(room, 'idle ttl');
    }

    idleRooms = Array.from(rooms.values())
      .filter((room) => room.clients.size === 0)
      .sort((a, b) => a.lastEmptyAt - b.lastEmptyAt);
    while (idleRooms.length > config.maxIdleRooms) {
      evictRoom(idleRooms.shift(), 'idle room limit');
    }
  };

  const broadcast = (room, sender, message) => {
    const payload = JSON.stringify(message);
    for (const client of room.clients) {
      if (client !== sender && client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  const sendRoomSync = (room, socket, clientId) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    const update = encodeStateAsUpdate(room.doc);
    logRoomEvent('sync.sent', room, { clientId, stateBytes: update.byteLength });
    socket.send(
      JSON.stringify({
        awareness: Array.from(room.awareness, ([awarenessClientId, state]) => ({
          clientId: awarenessClientId,
          state,
        })),
        type: 'sync',
        update: encodeUpdate(update),
      }),
    );
  };

  const getNextDeferredBootstrapClient = (room) => {
    for (const [candidate, clientId] of room.deferredSyncClients) {
      if (candidate.readyState === WebSocket.OPEN) return [candidate, clientId];
      if (candidate.readyState === WebSocket.CLOSED) room.deferredSyncClients.delete(candidate);
    }
    return null;
  };

  const armBootstrapTimer = (room) => {
    if (room.hasReceivedUpdate || !room.bootstrapOwner || room.bootstrapTimer) return;

    const owner = room.bootstrapOwner;
    const ownerClientId = room.bootstrapOwnerClientId;
    room.bootstrapTimer = setTimeout(() => {
      if (room.hasReceivedUpdate || room.bootstrapOwner !== owner) return;

      const nextOwner = getNextDeferredBootstrapClient(room);
      room.bootstrapTimer = null;

      // A solo owner is allowed to remain connected. A later deferred client
      // will re-arm this timer when it joins, so there is no polling timer or
      // repeated timeout log while a room is idle.
      if (!nextOwner) return;

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
    sendRoomSync(room, socket, clientId);
    armBootstrapTimer(room);
  };

  const flushDeferredSyncClients = (room) => {
    const clients = Array.from(room.deferredSyncClients);
    room.deferredSyncClients.clear();
    for (const [socket, clientId] of clients) sendRoomSync(room, socket, clientId);
  };

  const completeBootstrap = (room, socket, clientId) => {
    if (room.hasReceivedUpdate || room.bootstrapOwner !== socket) return false;
    room.hasReceivedUpdate = true;
    if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
    room.bootstrapTimer = null;
    room.bootstrapOwner = null;
    room.bootstrapOwnerClientId = null;
    logRoomEvent('bootstrap.completed', room, {
      clientId,
      deferredClientCount: room.deferredSyncClients.size,
    });
    flushDeferredSyncClients(room);
    return true;
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
  };

  const handleSocketConnection = (socket, request) => {
    const url = new URL(request.url || '/', `http://${request.headers.host}`);
    const roomMatch = url.pathname.match(/^\/collaboration\/([^/]+)$/);
    if (!roomMatch) {
      socket.close(1008, 'Invalid collaboration room.');
      return;
    }

    const id = decodeURIComponent(roomMatch[1]);
    const requestedClientId = Number(url.searchParams.get('clientId'));
    const clientId = Number.isSafeInteger(requestedClientId) ? requestedClientId : Date.now();
    const room = getRoom(id);

    socket.isAlive = true;
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
        if (!room.hasReceivedUpdate && room.bootstrapOwner !== socket) {
          socket.close(1008, 'Bootstrap owner required.');
          return;
        }
        try {
          const update = decodeUpdate(message.update);
          applyUpdate(room.doc, update, socket);
          room.lastActiveAt = now();
          completeBootstrap(room, socket, clientId);
          logRoomEvent('update.applied', room, {
            clientId,
            updateBytes: update.byteLength,
          });
          broadcast(room, socket, { ...message, sender: clientId });
        } catch {
          logRoomEvent('update.rejected', room, { clientId });
          socket.close(1003, 'Invalid Yjs update.');
        }
        return;
      }

      if (message.type === 'awareness') {
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

  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') return sendJson(response, 204);
    if (request.method === 'GET' && request.url === '/health') {
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === 'GET' && request.url === '/rooms') {
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

  return {
    close: async () => {
      for (const timer of timers) clearInterval(timer);
      for (const socket of wsServer.clients) socket.terminate();
      for (const room of rooms.values()) {
        if (room.bootstrapTimer) clearTimeout(room.bootstrapTimer);
        room.doc.destroy();
      }
      rooms.clear();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
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

module.exports = { createCollaborationServer };
