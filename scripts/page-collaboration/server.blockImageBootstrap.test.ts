// @vitest-environment node
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createMemoryCollaborationRoomBackend, type MemoryRoomBackendStore } from './roomBackend';
import { installPageCollaborationYjsSingleton } from './start.ts';

await installPageCollaborationYjsSingleton();

const yjs = await import('yjs');
const editorHeadless = await import('@lobehub/editor/headless');
const require = createRequire(import.meta.url);
const { createCollaborationServer, getYjsDocConstructorForTests } = require('./server.cjs') as {
  createCollaborationServer: (options?: Record<string, unknown>) => CollaborationServer;
  getYjsDocConstructorForTests: () => typeof yjs.Doc;
};

type CollaborationServer = {
  close: () => Promise<void>;
  listen: (port: number, host?: string) => Promise<{ port: number }>;
};

type Peer = {
  socket: WebSocket;
  sync: Promise<Record<string, unknown>>;
};

const ROOM_ID = 'block-image-bootstrap-room';
const USER_ID = 'block-image-bootstrap-user';
const WORKSPACE_ID = 'block-image-bootstrap-workspace';
const NODE_ID = 'legacy-block-image-node';

const servers: CollaborationServer[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
});

const nextMessage = (socket: WebSocket): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const onMessage = (message: WebSocket.RawData) => resolve(JSON.parse(String(message)));
    const onError = (error: Error) => reject(error);
    socket.once('message', onMessage);
    socket.once('error', onError);
  });

const connectWithHello = (url: string) =>
  new Promise<{ message: Record<string, unknown>; socket: WebSocket }>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('message', (message) => resolve({ message: JSON.parse(String(message)), socket }));
    socket.once('error', reject);
  });

const expectNoMessage = (socket: WebSocket, durationMs = 40): Promise<void> =>
  new Promise((resolve, reject) => {
    const onMessage = (message: WebSocket.RawData) => {
      clearTimeout(timer);
      reject(new Error(`unexpected message: ${String(message)}`));
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, durationMs);
    socket.once('message', onMessage);
  });

const createTicketVerifier = (input: Record<string, unknown>) => {
  const clientKind = input.clientKind as 'agent' | 'browser';
  const requestId = typeof input.requestId === 'string' ? input.requestId : undefined;
  return {
    allowed: true,
    clientKind,
    documentId: ROOM_ID,
    expiresAt: Date.now() + 60_000,
    jti: clientKind === 'agent' ? `agent:${requestId}` : 'browser:block-image-bootstrap',
    principal: {
      authoritative: clientKind === 'browser',
      canWrite: true,
      clientKind,
      documentId: ROOM_ID,
      requestId: requestId ?? null,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    },
    requestId,
    roomId: ROOM_ID,
    singleUse: clientKind === 'agent',
  };
};

const connectPeer = async (
  port: number,
  clientKind: 'agent' | 'browser',
  requestId?: string,
): Promise<Peer> => {
  const result = await connectWithHello(
    `ws://127.0.0.1:${port}/collaboration/${ROOM_ID}?protocol=lobe-yjs-v1`,
  );
  const auth = nextMessage(result.socket);
  result.socket.send(
    JSON.stringify({
      clientId: clientKind === 'browser' ? 1 : 2,
      clientKind,
      documentId: ROOM_ID,
      nonce: result.message.nonce,
      ...(requestId ? { requestId } : {}),
      protocol: 'lobe-yjs-v1',
      ticket: `${clientKind}:${requestId ?? 'room'}`,
      type: 'auth',
      version: 1,
    }),
  );
  await expect(auth).resolves.toMatchObject({ type: 'auth-ok' });

  const sync = nextMessage(result.socket);
  result.socket.send(
    JSON.stringify({
      protocol: 'lobe-yjs-v1',
      stateVector: Buffer.from([0]).toString('base64'),
      type: 'sync-request',
      version: 1,
    }),
  );
  return { socket: result.socket, sync };
};

const uploadedImage = {
  $: { properties: { nodeId: NODE_ID } },
  altText: '旧图',
  height: 90,
  maxWidth: 600,
  src: 'https://cdn.example.com/original.png',
  status: 'uploaded',
  type: 'block-image',
  version: 1,
  width: 160,
};

const paragraph = (text: string) => ({
  children: [
    {
      detail: 0,
      format: 0,
      mode: 'normal',
      style: '',
      text,
      type: 'text',
      version: 1,
    },
  ],
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  textStyle: '',
  type: 'paragraph',
  version: 1,
});

const legacyEditorData = {
  root: {
    children: [uploadedImage, paragraph('保留段落')],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
};

type YXmlNode = {
  applyDelta?: (delta: Array<Record<string, unknown>>) => void;
  getAttribute?: (key: string) => unknown;
  getAttributes?: () => Record<string, unknown>;
  insertEmbed?: (index: number, value: unknown) => void;
  length?: number;
  nodeName?: string;
  setAttribute?: (key: string, value: unknown) => void;
  toDelta?: () => Array<{ insert?: unknown }>;
};

const isYXmlNode = (value: unknown): value is YXmlNode =>
  Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as YXmlNode).getAttributes === 'function' &&
    typeof (value as YXmlNode).getAttribute === 'function',
  );

const cloneYMap = (value: InstanceType<typeof yjs.Map>): InstanceType<typeof yjs.Map> => {
  const clone = new yjs.Map();
  value.forEach((entry, key) => clone.set(key, structuredClone(entry)));
  return clone;
};

const cloneYValue = (value: unknown): unknown => {
  if (value instanceof yjs.Map) return cloneYMap(value);
  if (!isYXmlNode(value)) return structuredClone(value);

  const clone =
    value instanceof yjs.XmlElement
      ? new yjs.XmlElement(value.nodeName || 'UNDEFINED')
      : new yjs.XmlText();
  for (const [key, entry] of Object.entries(value.getAttributes?.() ?? {})) {
    clone.setAttribute(key, entry instanceof yjs.Map ? cloneYMap(entry) : structuredClone(entry));
  }
  if (value.toDelta && clone instanceof yjs.XmlText) {
    clone.applyDelta(
      value
        .toDelta()
        .map((operation) =>
          typeof operation.insert === 'string'
            ? { insert: operation.insert }
            : { insert: cloneYValue(operation.insert) },
        ),
    );
  }
  return clone;
};

const findYNode = (value: unknown, type: string): YXmlNode | null => {
  if (!isYXmlNode(value)) return null;
  if (value.getAttribute?.('__type') === type) return value;
  for (const operation of value.toDelta?.() ?? []) {
    const result = findYNode(operation.insert, type);
    if (result) return result;
  }
  return null;
};

const readRootTypes = (doc: InstanceType<typeof yjs.Doc>): string[] =>
  doc
    .get('root', yjs.XmlText)
    .toDelta()
    .flatMap((operation) => {
      const type = isYXmlNode(operation.insert)
        ? operation.insert.getAttribute?.('__type')
        : undefined;
      return typeof type === 'string' ? [type] : [];
    });

const readBlockImageNodeIds = (doc: InstanceType<typeof yjs.Doc>): string[] => {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (!isYXmlNode(value)) return;
    if (value.getAttribute?.('__type') === 'block-image') {
      const state = value.getAttribute?.('__state') as
        { get?: (key: string) => unknown } | undefined;
      const properties = state?.get?.('properties') as { nodeId?: unknown } | undefined;
      if (typeof properties?.nodeId === 'string') ids.push(properties.nodeId);
    }
    for (const operation of value.toDelta?.() ?? []) visit(operation.insert);
  };
  doc
    .get('root', yjs.XmlText)
    .toDelta()
    .forEach((operation) => visit(operation.insert));
  return ids;
};

const createLegacyBareSnapshot = async (): Promise<{
  stateVector: Uint8Array;
  update: Uint8Array;
}> => {
  const canonical = await editorHeadless.createImmutableYjsSnapshotFromEditorData({
    editorData: legacyEditorData,
    revision: 0,
    roomId: ROOM_ID,
  });
  const canonicalDoc = new yjs.Doc();
  yjs.applyUpdate(canonicalDoc, canonical.update);
  const canonicalRoot = canonicalDoc.get('root', yjs.XmlText);
  const bareDoc = new yjs.Doc();
  const bareRoot = bareDoc.get('root', yjs.XmlText);

  try {
    for (const operation of canonicalRoot.toDelta()) {
      const value = operation.insert;
      const child =
        isYXmlNode(value) && value.getAttribute?.('__type') === 'hole'
          ? findYNode(value, 'block-image')
          : isYXmlNode(value)
            ? value
            : null;
      if (child) bareRoot.insertEmbed(bareRoot.length, cloneYValue(child));
    }
    expect(readRootTypes(bareDoc)).toEqual(['block-image', 'paragraph']);
    expect(readBlockImageNodeIds(bareDoc)).toEqual([NODE_ID]);
    return {
      stateVector: new Uint8Array(yjs.encodeStateVector(bareDoc)),
      update: new Uint8Array(yjs.encodeStateAsUpdate(bareDoc)),
    };
  } finally {
    canonicalDoc.destroy();
    bareDoc.destroy();
  }
};

const createMigratedSnapshot = async (): Promise<{
  stateVector: Uint8Array;
  update: Uint8Array;
}> =>
  editorHeadless.createImmutableYjsSnapshotFromEditorData({
    editorData: legacyEditorData,
    revision: 0,
    roomId: ROOM_ID,
  });

const createBackend = (
  instanceId: string,
  store: MemoryRoomBackendStore,
  snapshot: { stateVector: Uint8Array; update: Uint8Array },
) =>
  createMemoryCollaborationRoomBackend({
    instanceId,
    leaseMs: 1_000,
    requireScope: true,
    snapshotLoader: async () => ({
      bootstrapReady: false,
      revision: 0,
      stateVector: new Uint8Array(snapshot.stateVector),
      update: new Uint8Array(snapshot.update),
    }),
    store,
  });

const createRelay = (
  backend: ReturnType<typeof createMemoryCollaborationRoomBackend>,
  migrateLegacyBlockImagesInYjsDoc: (input: {
    doc: InstanceType<typeof yjs.Doc>;
    roomId: string;
  }) => Promise<{ changed: boolean; stateVector: Uint8Array; update: Uint8Array }>,
) => {
  const server = createCollaborationServer({
    allowLegacyProtocol: false,
    logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
    migrateLegacyBlockImagesInYjsDoc,
    roomBackend: backend,
    ticketVerifier: createTicketVerifier,
  });
  servers.push(server);
  return server;
};

const captureUpdate = (doc: InstanceType<typeof yjs.Doc>, mutate: () => void): Uint8Array => {
  let update: Uint8Array | undefined;
  const onUpdate = (value: Uint8Array) => {
    update = new Uint8Array(value);
  };
  doc.on('update', onUpdate);
  try {
    mutate();
  } finally {
    doc.off('update', onUpdate);
  }
  if (!update) throw new Error('Expected a Yjs update.');
  return update;
};

const sendUpdate = async (peer: Peer, update: Uint8Array, messageId: string, remotePeer?: Peer) => {
  const acknowledgement = nextMessage(peer.socket);
  const remoteUpdate = remotePeer ? nextMessage(remotePeer.socket) : undefined;
  peer.socket.send(
    JSON.stringify({
      messageId,
      protocol: 'lobe-yjs-v1',
      type: 'update',
      update: Buffer.from(update).toString('base64'),
      version: 1,
    }),
  );
  await expect(acknowledgement).resolves.toMatchObject({ type: 'update-ack' });
  if (!remoteUpdate) return null;
  const message = await remoteUpdate;
  expect(message).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'update' });
  return message;
};

describe('page collaboration block-image bootstrap integration', () => {
  it('runs one owner migration before two relays release their initial sync gate', async () => {
    const snapshot = await createLegacyBareSnapshot();
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const backendA = await createBackend('block-image-relay-a', store, snapshot);
    const backendB = await createBackend('block-image-relay-b', store, snapshot);
    const migrationCalls: Array<{ doc: InstanceType<typeof yjs.Doc>; roomId: string }> = [];
    let releaseMigration!: () => void;
    const migrationRelease = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    let migrationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      migrationStarted = resolve;
    });
    const migrate = async (input: { doc: InstanceType<typeof yjs.Doc>; roomId: string }) => {
      migrationCalls.push(input);
      migrationStarted();
      await migrationRelease;
      return editorHeadless.migrateLegacyBlockImagesInYjsDoc(input);
    };

    expect(getYjsDocConstructorForTests()).toBe(yjs.Doc);
    const relayA = createRelay(backendA, migrate);
    const relayB = createRelay(backendB, migrate);
    const addressA = await relayA.listen(0);
    const addressB = await relayB.listen(0);
    const browser = await connectPeer(addressA.port, 'browser');
    const agent = await connectPeer(addressB.port, 'agent', 'block-image-agent');

    await started;
    expect(migrationCalls).toHaveLength(1);
    await expectNoMessage(browser.socket);
    await expectNoMessage(agent.socket);
    releaseMigration();

    const [browserSync, agentSync] = await Promise.all([browser.sync, agent.sync]);
    expect(browserSync).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'sync' });
    expect(agentSync).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'sync' });
    const browserDoc = new yjs.Doc();
    const agentDoc = new yjs.Doc();
    yjs.applyUpdate(browserDoc, Buffer.from(String(browserSync.update), 'base64'));
    yjs.applyUpdate(agentDoc, Buffer.from(String(agentSync.update), 'base64'));
    expect(readRootTypes(browserDoc)).toEqual(['hole', 'paragraph']);
    expect(readRootTypes(agentDoc)).toEqual(['hole', 'paragraph']);
    expect(readBlockImageNodeIds(browserDoc)).toEqual([NODE_ID]);
    expect(readBlockImageNodeIds(agentDoc)).toEqual([NODE_ID]);

    const browserImage = findYNode(browserDoc.get('root', yjs.XmlText), 'block-image');
    const browserParagraph = findYNode(browserDoc.get('root', yjs.XmlText), 'paragraph');
    expect(browserImage).not.toBeNull();
    expect(browserParagraph).not.toBeNull();
    const changedSrc = 'https://cdn.example.com/after-bootstrap.png';
    const update = captureUpdate(browserDoc, () => {
      browserDoc.transact(() => {
        browserImage!.setAttribute?.('__src', changedSrc);
        browserImage!.setAttribute?.('__status', 'uploaded');
        const text = browserParagraph!
          .toDelta?.()
          .find((operation) => typeof operation.insert === 'string');
        const textLength = typeof text?.insert === 'string' ? text.insert.length : 0;
        (
          browserParagraph as YXmlNode & { insert?: (index: number, value: string) => void }
        ).insert?.(browserParagraph.length ?? textLength, ' 两端更新');
      }, 'human');
    });
    const remoteMessage = await sendUpdate(browser, update, 'block-image-after-bootstrap', agent);
    yjs.applyUpdate(agentDoc, Buffer.from(String(remoteMessage?.update), 'base64'));

    expect(
      findYNode(browserDoc.get('root', yjs.XmlText), 'block-image')?.getAttribute?.('__src'),
    ).toBe(changedSrc);
    expect(
      findYNode(agentDoc.get('root', yjs.XmlText), 'block-image')?.getAttribute?.('__src'),
    ).toBe(changedSrc);
    expect(browserParagraph?.toString()).toContain('两端更新');
    expect(findYNode(agentDoc.get('root', yjs.XmlText), 'paragraph')?.toString()).toContain(
      '两端更新',
    );
    expect(readBlockImageNodeIds(browserDoc)).toEqual([NODE_ID]);
    expect(readBlockImageNodeIds(agentDoc)).toEqual([NODE_ID]);

    const projection = await editorHeadless.exportYjsSnapshotProjection({
      roomId: ROOM_ID,
      update: yjs.encodeStateAsUpdate(agentDoc),
    });
    const projectedChildren = (projection.editorData.root as { children: Array<{ type: string }> })
      .children;
    expect(projectedChildren.filter(({ type }) => type === 'block-image')).toHaveLength(1);
    expect(projectedChildren.filter(({ type }) => type === 'hole')).toHaveLength(0);
    expect(projection.markdown).toContain('保留段落');
    expect(projection.markdown).toContain('两端更新');

    browserDoc.destroy();
    agentDoc.destroy();
    browser.socket.close();
    agent.socket.close();
  });

  it('completes a no-op owner migration with the valid empty Yjs delta', async () => {
    const snapshot = await createMigratedSnapshot();
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const backend = await createBackend('block-image-no-op-relay', store, snapshot);
    const migrationResults: Array<{
      changed: boolean;
      stateVector: Uint8Array;
      update: Uint8Array;
    }> = [];
    const migrate = async (input: { doc: InstanceType<typeof yjs.Doc>; roomId: string }) => {
      const result = await editorHeadless.migrateLegacyBlockImagesInYjsDoc(input);
      migrationResults.push(result);
      return result;
    };
    const relay = createRelay(backend, migrate);
    const address = await relay.listen(0);
    const peer = await connectPeer(address.port, 'browser');
    const sync = await peer.sync;

    expect(sync).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'sync' });
    expect(migrationResults).toHaveLength(1);
    expect(migrationResults[0].changed).toBe(false);
    expect(yjs.decodeUpdate(migrationResults[0].update).structs).toHaveLength(0);
    expect(readRootTypesFromUpdate(sync.update)).toEqual(['hole', 'paragraph']);
    peer.socket.close();
  });
});

const readRootTypesFromUpdate = (encodedUpdate: unknown): string[] => {
  const doc = new yjs.Doc();
  try {
    yjs.applyUpdate(doc, Buffer.from(String(encodedUpdate), 'base64'));
    return readRootTypes(doc);
  } finally {
    doc.destroy();
  }
};
