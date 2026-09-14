// @vitest-environment node

import { createRequire } from 'node:module';

import type { HeadlessEditor, WebSocketConstructor, WebSocketYjsProvider } from '@lobehub/editor';
import {
  captureCollaborativeRewriteSelection,
  createWebSocketYjsProvider,
  hashRewriteText,
  HeadlessEditor as EditorHeadlessEditor,
  YjsPlugin,
} from '@lobehub/editor';
import {
  APPLY_BLOCK_REWRITE_COMMAND,
  CollaborativeAgentEditor,
  type CollaborativeAgentEditorConnectOptions,
} from '@lobehub/editor/headless';
import {
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { Doc } from 'yjs';

import type {
  DocumentRewriteRequestItem,
  DocumentRewriteSelection,
} from '@/database/schemas/documentRewriteRequest';

import {
  type CollaborationRoomBackend,
  createMemoryCollaborationRoomBackend,
  type MemoryRoomBackendStore,
} from '../../../../../scripts/page-collaboration/roomBackend';
import { DocumentRewriteRoomTicketService } from '../documentRewrite/roomTicket';
import {
  DocumentRewriteWorker,
  type RewriteGeneratorChunkHandler,
  type RewriteGeneratorInput,
  type RewriteGeneratorOutput,
} from '../documentRewrite/worker';
import {
  createDocumentCollaborationRoomTicketVerifier,
  DocumentCollaborationBrowserTicketService,
} from './browserTicket';
import type {
  CollaborationRoomPersistenceEvent,
  DocumentPersistenceRepository,
  DocumentPersistenceVersion,
  ReadOnlyHeadlessExporter,
} from './persistence';
import { DocumentPersistenceService } from './persistence';

// The relay is intentionally a CommonJS module. Mock the editor's ESM import
// to the same CJS Yjs export so the integration test exercises one constructor
// identity, just like the production CJS relay process.
vi.mock('yjs', () => {
  const requireYjs = createRequire(import.meta.url);
  return requireYjs('yjs');
});

const require = createRequire(import.meta.url);
const { createCollaborationServer } =
  require('../../../../../scripts/page-collaboration/server.cjs') as {
    createCollaborationServer: (options?: Record<string, unknown>) => {
      close: () => Promise<void>;
      flushRoom: (roomId: string, reason?: string) => Promise<unknown>;
      listen: (port: number, host?: string) => Promise<{ port: number }>;
    };
  };

const DOCUMENT_ID = 'phase6-cross-segment-document';
const ROOM_ID = DOCUMENT_ID;
const USER_ID = 'phase6-user';
const WORKSPACE_ID = 'phase6-workspace';
const AGENT_ID = 'phase6-agent';
const REQUEST_ID = 'phase6-request';
const WORKER_ID = 'phase6-worker';
const BROWSER_SECRET = 'phase6-browser-hmac';
const AGENT_SECRET = 'phase6-agent-hmac';

const servers: Array<{ close: () => Promise<void> }> = [];
const browserClients: BrowserClient[] = [];
const editors: HeadlessEditor[] = [];
const agentSessions: CollaborativeAgentEditor[] = [];
const persistedEvents: CollaborationRoomPersistenceEvent[] = [];

afterEach(async () => {
  persistedEvents.splice(0, persistedEvents.length);
  while (agentSessions.length > 0) await agentSessions.pop()!.disconnect();
  while (browserClients.length > 0) {
    const client = browserClients.pop()!;
    client.provider.disconnect();
    client.editor.destroy();
  }
  while (editors.length > 0) editors.pop()!.destroy();
  while (servers.length > 0) await servers.pop()!.close();
});

class Deferred<T> {
  readonly promise: Promise<T>;
  private rejectPromise!: (error: unknown) => void;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  reject(error: unknown): void {
    this.rejectPromise(error);
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }
}

interface BrowserClient {
  editor: EditorHeadlessEditor;
  label: string;
  lexical: LexicalEditor;
  provider: WebSocketYjsProvider;
  wire: string[];
}

interface FakeRequestStore {
  cancel: () => void;
  request: DocumentRewriteRequestItem;
}

const createWebSocketConstructor = (wire: string[]): WebSocketConstructor => {
  class RecordingWebSocket extends WebSocket {
    constructor(url: string) {
      super(url);
    }

    send(data: any): void {
      if (typeof data === 'string') wire.push(data);
      super.send(data);
    }
  }

  return RecordingWebSocket as unknown as WebSocketConstructor;
};

const createBrowser = (input: {
  label: string;
  port: number;
  shouldBootstrap: boolean;
  ticket: string;
}): BrowserClient => {
  const wire: string[] = [];
  const docMap = new Map<string, Doc>();
  const provider = createWebSocketYjsProvider(ROOM_ID, docMap, {
    documentId: DOCUMENT_ID,
    legacyProtocol: false,
    ticket: input.ticket,
    webSocketConstructor: createWebSocketConstructor(wire),
    wsBaseUrl: `ws://127.0.0.1:${input.port}`,
  });
  const editor = new EditorHeadlessEditor({
    additionalPlugins: [
      [
        YjsPlugin,
        {
          id: ROOM_ID,
          providerFactory: () => provider,
          shouldBootstrap: input.shouldBootstrap,
          yjsDoc: docMap.get(ROOM_ID),
        },
      ],
    ],
  });
  editors.push(editor);
  const lexical = editor.kernel.getLexicalEditor();
  if (!lexical) throw new Error(`Missing Lexical editor for ${input.label}`);
  const client = { editor, label: input.label, lexical, provider, wire };
  browserClients.push(client);
  return client;
};

const hydrateBrowserAndWaitForSync = async (
  client: BrowserClient,
  content: SerializedEditorState<SerializedLexicalNode> | string | null,
): Promise<void> => {
  const sync = client.provider.waitForSync();
  if (content === null) client.provider.connect();
  else if (typeof content === 'string') client.editor.hydrateMarkdown(content);
  else client.editor.hydrateEditorData(content);
  await sync;
};

const readRootText = (client: BrowserClient): string => {
  let text = '';
  client.lexical.getEditorState().read(() => {
    text = $getRoot().getTextContent();
  });
  return text;
};

const containsSerializedType = (value: unknown, type: string): boolean => {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsSerializedType(entry, type));
  const record = value as Record<string, unknown>;
  return (
    record.type === type ||
    Object.values(record).some((entry) => containsSerializedType(entry, type))
  );
};

const hasPendingDiff = (client: BrowserClient): boolean =>
  containsSerializedType(client.editor.export().editorData, 'diff');

const hasStreamingRegionMarker = (client: BrowserClient): boolean => {
  const serialized = JSON.stringify(client.editor.export().editorData);
  return /rewriteRegionStatus|rewriteGenerationId|rewriteSessionId/.test(serialized);
};

const waitFor = async (
  check: () => boolean,
  subscribe: (notify: () => void) => () => void,
  label: string,
  timeoutMs = 15_000,
): Promise<void> => {
  if (check()) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    const notify = () => {
      if (settled) return;
      try {
        if (!check()) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        reject(error);
      }
    };
    unsubscribe = subscribe(notify);
    notify();
  });
};

const waitForEditor = (client: BrowserClient, check: () => boolean, label: string): Promise<void> =>
  waitFor(
    check,
    (notify) => client.lexical.registerUpdateListener(() => notify()),
    `${client.label} ${label}`,
  );

const waitForAwareness = (
  client: BrowserClient,
  status: string,
  requestId = REQUEST_ID,
): Promise<void> =>
  waitFor(
    () =>
      Array.from(client.provider.awareness.getStates().values()).some(
        (state) =>
          (state as { awarenessData?: { requestId?: string; status?: string } }).awarenessData
            ?.requestId === requestId &&
          (state as { awarenessData?: { requestId?: string; status?: string } }).awarenessData
            ?.status === status,
      ),
    (notify) => {
      client.provider.awareness.on('update', notify);
      return () => client.provider.awareness.off('update', notify);
    },
    `${client.label} Agent awareness ${status}`,
  );

const waitForAgentUpdate = (session: CollaborativeAgentEditor): Promise<void> => {
  const provider = (
    session as unknown as {
      provider: {
        off: (type: 'update', listener: (update: Uint8Array) => void) => void;
        on: (type: 'update', listener: (update: Uint8Array) => void) => void;
      };
    }
  ).provider;
  return new Promise<void>((resolve) => {
    const listener = () => {
      provider.off('update', listener);
      resolve();
    };
    provider.on('update', listener);
  });
};

const selectCrossSegmentText = (client: BrowserClient, selectAll = false): void => {
  client.lexical.update(
    () => {
      const first = $getRoot().getFirstChild();
      const second = first?.getNextSibling();
      const start = first && $isElementNode(first) ? first.getFirstChild() : null;
      const end = second && $isElementNode(second) ? second.getLastChild() : null;
      if (!start || !end || !$isTextNode(start) || !$isTextNode(end)) {
        throw new Error('Expected two text-backed blocks for cross-segment selection.');
      }
      const selection = $createRangeSelection();
      selection.anchor.set(start.getKey(), selectAll ? 0 : 2, 'text');
      selection.focus.set(
        end.getKey(),
        selectAll ? end.getTextContentSize() : Math.max(1, end.getTextContentSize() - 2),
        'text',
      );
      $setSelection(selection);
    },
    { discrete: true },
  );
};

/** Select one complete top-level paragraph, preserving its real RelativePosition. */
const selectParagraphText = (client: BrowserClient, paragraphIndex: number): void => {
  client.lexical.update(
    () => {
      const paragraph = $getRoot().getChildren()[paragraphIndex];
      const text = paragraph && $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
      if (!text || !$isTextNode(text)) {
        throw new Error(`Expected paragraph ${paragraphIndex} to contain a text node.`);
      }
      const selection = $createRangeSelection();
      selection.anchor.set(text.getKey(), 0, 'text');
      selection.focus.set(text.getKey(), text.getTextContentSize(), 'text');
      $setSelection(selection);
    },
    { discrete: true },
  );
};

const makeRequest = (selection: DocumentRewriteSelection): DocumentRewriteRequestItem => {
  const now = new Date();
  return {
    agentId: AGENT_ID,
    attempt: 1,
    cancelRequestedAt: null,
    claimedAt: null,
    claimOwner: null,
    createdAt: now,
    documentId: DOCUMENT_ID,
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(now.getTime() + 60_000),
    generationId: null,
    id: REQUEST_ID,
    instruction: 'Rewrite this cross-segment selection in a concise style.',
    lastCommandId: null,
    leaseExpiresAt: null,
    model: null,
    nextAttemptAt: null,
    outputText: null,
    operationId: null,
    parentRequestId: null,
    progress: null,
    provider: null,
    quotedText: selection.quotedText,
    requestedByUserId: USER_ID,
    requestedModel: null,
    requestedProvider: null,
    selection,
    sessionId: 'rws_multi-client-test',
    status: 'queued',
    targetKey: selection.targetNodeIds?.join(':') ?? null,
    targetNodeIds: selection.targetNodeIds ?? [],
    terminalAt: null,
    toolCallId: null,
    topicId: 'phase6-topic',
    turnIndex: 1,
    updatedAt: now,
    version: 1,
    workspaceId: WORKSPACE_ID,
  };
};

const makeNodeSelection = (
  nodeId: string,
  source: string,
  quotedText = 'Lease Verified',
): DocumentRewriteSelection => ({
  adapterId: 'artifact',
  endNodeId: nodeId,
  endOffset: 1,
  kind: 'block',
  quotedText,
  quotedTextHash: hashRewriteText(quotedText),
  roomId: ROOM_ID,
  sourceHash: hashRewriteText(source),
  startNodeId: nodeId,
  startOffset: 0,
  targetKind: 'node',
  targetNodeId: nodeId,
  targetNodeIds: [nodeId],
});

const makeNodeRequest = (input: {
  id: string;
  parentRequestId?: string | null;
  selection: DocumentRewriteSelection;
  sessionId: string;
  turnIndex: number;
}): DocumentRewriteRequestItem => ({
  ...makeRequest(input.selection),
  id: input.id,
  instruction: `Rewrite node turn ${input.turnIndex}`,
  parentRequestId: input.parentRequestId ?? null,
  sessionId: input.sessionId,
  targetKey: input.selection.targetNodeId ?? null,
  targetNodeIds: input.selection.targetNodeIds ?? [],
  turnIndex: input.turnIndex,
});

const readNodeSource = (client: BrowserClient, nodeId: string): string | undefined => {
  const visit = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    if (Array.isArray(value)) {
      for (const child of value) {
        const source = visit(child);
        if (source !== undefined) return source;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const properties =
      record.$ && typeof record.$ === 'object' && !Array.isArray(record.$)
        ? (record.$ as Record<string, unknown>).properties
        : undefined;
    const serializedProperties =
      properties && typeof properties === 'object' && !Array.isArray(properties)
        ? (properties as Record<string, unknown>)
        : undefined;
    if (serializedProperties?.nodeId === nodeId && typeof record.html === 'string') {
      return record.html;
    }
    for (const child of Object.values(record)) {
      const source = visit(child);
      if (source !== undefined) return source;
    }
    return undefined;
  };

  return visit(client.editor.export().editorData);
};

const toRequestSelection = (
  selection: Extract<ReturnType<typeof captureCollaborativeRewriteSelection>, { kind: 'relative' }>,
): DocumentRewriteSelection => ({
  ...selection,
  anchorPos: structuredClone(selection.anchorPos) as unknown as Record<string, unknown>,
  focusPos: structuredClone(selection.focusPos) as unknown as Record<string, unknown>,
});

class MemoryPersistenceRepository implements DocumentPersistenceRepository {
  version: DocumentPersistenceVersion = {
    documentUpdatedAt: 0,
    revision: 0,
    snapshotUpdate: null,
    stateVector: '',
    token: '0',
  };
  history: Array<{ idempotencyKey: string; requestId: string | null; source: string }> = [];
  projection: { editorData: Record<string, unknown>; markdown: string } | null = null;

  async readVersion(): Promise<DocumentPersistenceVersion> {
    return { ...this.version };
  }

  async compareAndSet(input: Parameters<DocumentPersistenceRepository['compareAndSet']>[0]) {
    if (
      input.expected.token !== this.version.token ||
      input.expected.revision !== this.version.revision ||
      input.expected.stateVector !== this.version.stateVector ||
      input.expected.snapshotUpdate !== this.version.snapshotUpdate ||
      (input.expected.documentUpdatedAt ?? 0) !== (this.version.documentUpdatedAt ?? 0)
    ) {
      return { status: 'conflict' as const };
    }
    const snapshotUpdate = Buffer.from(input.next.snapshot.update).toString('base64');
    if (
      input.next.stateVector === this.version.stateVector &&
      snapshotUpdate === this.version.snapshotUpdate
    ) {
      return { status: 'duplicate' as const, version: { ...this.version } };
    }
    this.projection = {
      editorData: input.next.editorData,
      markdown: input.next.markdown,
    };
    for (const history of [input.history, ...(input.additionalHistories ?? [])]) {
      this.history.push({
        idempotencyKey: history.idempotencyKey,
        requestId: history.requestId,
        source: history.source,
      });
    }
    this.version = {
      documentUpdatedAt: (this.version.documentUpdatedAt ?? 0) + 1,
      revision: input.next.revision,
      roomId: input.next.roomId,
      snapshotUpdate,
      stateVector: input.next.stateVector,
      token: String(Number(this.version.token ?? '0') + 1),
    };
    return {
      historyId: `history-${this.history.length}`,
      status: 'persisted' as const,
      version: { ...this.version },
    };
  }
}

const makePersistence = (repository: MemoryPersistenceRepository): DocumentPersistenceService => {
  const exporter: ReadOnlyHeadlessExporter = {
    exportProjection: async ({ roomId, snapshot }) => {
      const module = await import('@lobehub/editor/headless');
      return module.exportYjsSnapshotProjection({ roomId, update: snapshot.update });
    },
  };
  return new DocumentPersistenceService({
    exporter,
    repository,
    resolveHistory: (event) => {
      const principal = event.principal as { clientKind?: string; requestId?: string } | null;
      return principal?.clientKind === 'agent'
        ? {
            requestId: principal.requestId ?? event.requestIds[0] ?? null,
            saveSource: 'llm_call',
            source: 'agent_collaboration',
          }
        : { requestId: null, saveSource: 'autosave', source: 'collaboration' };
    },
  });
};

const createLifecycle = (
  request: DocumentRewriteRequestItem,
  agentTickets: DocumentRewriteRoomTicketService,
  isDirectPersisted: () => boolean = () => true,
): FakeRequestStore & {
  lifecycle: ConstructorParameters<typeof DocumentRewriteWorker>[0]['requestService'];
} => {
  let current = { ...request };
  const clone = () => ({ ...current, selection: { ...current.selection } });
  const lifecycle = {
    claim: async (id: string, input: { attempt: number; leaseMs?: number; workerId: string }) => {
      if (id !== current.id || input.attempt !== current.attempt || current.status !== 'queued') {
        return undefined;
      }
      current = {
        ...current,
        claimOwner: input.workerId,
        claimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + (input.leaseMs ?? 60_000)),
        status: 'connecting',
        updatedAt: new Date(),
      };
      return clone();
    },
    findById: async (id: string) => (id === current.id ? clone() : undefined),
    issueRoomTicket: async (
      id: string,
      input: { attempt: number; roomId?: string; workerId: string },
    ) =>
      agentTickets.issue({
        agentId: current.agentId,
        attempt: input.attempt,
        documentId: current.documentId,
        requestId: id,
        roomId: input.roomId ?? ROOM_ID,
        userId: current.requestedByUserId,
        workerId: input.workerId,
        workspaceId: current.workspaceId,
      }),
    renewLease: async (
      id: string,
      input: { attempt: number; leaseMs?: number; workerId: string },
    ) => {
      if (
        id !== current.id ||
        current.attempt !== input.attempt ||
        current.claimOwner !== input.workerId ||
        current.status === 'canceled'
      ) {
        return undefined;
      }
      current = {
        ...current,
        leaseExpiresAt: new Date(Date.now() + (input.leaseMs ?? 60_000)),
        updatedAt: new Date(),
      };
      return clone();
    },
    transitionWorker: async (
      id: string,
      input: {
        attempt: number;
        errorCode?: string | null;
        errorMessage?: string | null;
        generationId?: string | null;
        lastCommandId?: string | null;
        model?: string | null;
        nextAttemptAt?: Date | null;
        provider?: string | null;
        status: DocumentRewriteRequestItem['status'];
        workerId: string;
      },
    ) => {
      if (
        id !== current.id ||
        current.attempt !== input.attempt ||
        current.claimOwner !== input.workerId
      ) {
        return undefined;
      }
      current = {
        ...current,
        ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
        ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
        ...(input.generationId !== undefined ? { generationId: input.generationId } : {}),
        ...(input.lastCommandId !== undefined ? { lastCommandId: input.lastCommandId } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.nextAttemptAt !== undefined ? { nextAttemptAt: input.nextAttemptAt } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        status: input.status,
        updatedAt: new Date(),
      };
      return { isDuplicate: false, request: clone() };
    },
    markDirectApplied: async (
      id: string,
      input: {
        attempt: number;
        commandId: string;
        generationId?: string | null;
        model?: string | null;
        provider?: string | null;
        stateVector?: string | null;
        workerId: string;
      },
    ) => {
      if (!isDirectPersisted() || id !== current.id || input.attempt !== current.attempt) {
        return undefined;
      }
      if (current.status === 'applied') return { isDuplicate: true, request: clone() };
      if (current.status !== 'writing' && current.status !== 'cancel_requested') {
        return undefined;
      }
      current = {
        ...current,
        errorCode:
          current.status === 'cancel_requested'
            ? (current.errorCode ?? 'CANCELED_AFTER_WRITE')
            : current.errorCode,
        generationId: input.generationId ?? current.generationId,
        lastCommandId: input.commandId,
        model: input.model ?? current.model,
        provider: input.provider ?? current.provider,
        status: 'applied',
        updatedAt: new Date(),
      };
      return { isDuplicate: false, request: clone() };
    },
  };
  return {
    cancel: () => {
      current = { ...current, status: 'cancel_requested', updatedAt: new Date() };
    },
    get request() {
      return current;
    },
    lifecycle,
  };
};

const createUnifiedVerifier = (
  browserTickets: DocumentCollaborationBrowserTicketService,
  agentTickets: DocumentRewriteRoomTicketService,
) =>
  createDocumentCollaborationRoomTicketVerifier({
    agentVerifier: async (input) => {
      if (input.clientKind !== 'agent') return false;
      const claims = agentTickets.consume(input.ticket ?? '', {
        clientKind: 'agent',
        documentId: input.documentId,
        requestId: input.requestId,
        roomId: input.roomId,
        workerId: input.workerId,
      });
      const allowed =
        claims.userId === USER_ID &&
        claims.workspaceId === WORKSPACE_ID &&
        claims.documentId === DOCUMENT_ID &&
        claims.roomId === ROOM_ID &&
        claims.agentId === AGENT_ID;
      if (!allowed) return false;
      return {
        ...claims,
        allowed: true,
        principal: { ...claims, clientKind: 'agent', roomId: ROOM_ID },
      };
    },
    browser: {
      authorize: async (claims) =>
        claims.userId === USER_ID &&
        claims.workspaceId === WORKSPACE_ID &&
        claims.documentId === DOCUMENT_ID &&
        claims.roomId === ROOM_ID,
      ticketService: browserTickets,
    },
  });

const createServer = async (input: {
  agentTickets: DocumentRewriteRoomTicketService;
  browserTickets: DocumentCollaborationBrowserTicketService;
  maxBrowserClients?: number;
  onRoomUpdate: (event: CollaborationRoomPersistenceEvent) => Promise<unknown>;
  roomBackend?: CollaborationRoomBackend;
}) => {
  const server = createCollaborationServer({
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    // Existing two-browser acceptance cases exercise reconnect/peer behavior;
    // the multi-Agent capacity case below opts into the production one-browser
    // room contract explicitly.
    maxBrowserClients: input.maxBrowserClients ?? 2,
    onRoomUpdate: input.onRoomUpdate,
    ...(input.roomBackend ? { roomBackend: input.roomBackend } : {}),
    roomUpdateDebounceMs: 5,
    ticketVerifier: createUnifiedVerifier(input.browserTickets, input.agentTickets),
  });
  servers.push(server);
  const address = await server.listen(0);
  return { address, server };
};

describe('Phase 6 multi-client collaboration acceptance', () => {
  it('broadcasts two consecutive node rewrites to the same browser without reload', async () => {
    const browserTickets = new DocumentCollaborationBrowserTicketService({
      secret: `${BROWSER_SECRET}-node-two-rounds`,
    });
    const agentTickets = new DocumentRewriteRoomTicketService({
      secret: `${AGENT_SECRET}-node-two-rounds`,
    });
    const browserTicket = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const repository = new MemoryPersistenceRepository();
    const persistence = makePersistence(repository);
    const backendStore: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const backendA = createMemoryCollaborationRoomBackend({
      instanceId: 'node-two-rounds-relay-a',
      requireScope: true,
      store: backendStore,
    });
    const backendB = createMemoryCollaborationRoomBackend({
      instanceId: 'node-two-rounds-relay-b',
      requireScope: true,
      store: backendStore,
    });
    const first = await createServer({
      agentTickets,
      browserTickets,
      onRoomUpdate: (event) => persistence.onRoomUpdate(event),
      roomBackend: backendA,
    });
    const second = await createServer({
      agentTickets,
      browserTickets,
      onRoomUpdate: (event) => persistence.onRoomUpdate(event),
      roomBackend: backendB,
    });
    const browser = createBrowser({
      label: 'node-two-rounds-browser',
      port: first.address.port,
      shouldBootstrap: true,
      ticket: browserTicket,
    });
    const nodeId = 'node-two-rounds-artifact';
    const initialSource = '<main>Initial artifact</main>';
    await hydrateBrowserAndWaitForSync(browser, {
      root: {
        children: [
          {
            $: { properties: { nodeId } },
            html: initialSource,
            title: 'Lease Verified',
            type: 'artifact',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    } as unknown as SerializedEditorState<SerializedLexicalNode>);

    const runNodeWorker = async (input: {
      id: string;
      parentRequestId?: string | null;
      relayPort?: number;
      replacement: string;
      source: string;
      turnIndex: number;
    }) => {
      const request = makeNodeRequest({
        id: input.id,
        parentRequestId: input.parentRequestId,
        selection: makeNodeSelection(nodeId, input.source),
        sessionId: 'rws-node-two-rounds',
        turnIndex: input.turnIndex,
      });
      const store = createLifecycle(request, agentTickets, () =>
        repository.history.some((entry) => entry.requestId === input.id),
      );
      const agentWire: string[] = [];
      const workerErrors: string[] = [];
      const worker = new DocumentRewriteWorker({
        blockRewriteCommand: APPLY_BLOCK_REWRITE_COMMAND,
        editorFactory: {
          create: async (options: CollaborativeAgentEditorConnectOptions) => {
            const agent = await CollaborativeAgentEditor.create({
              ...options,
              providerOptions: {
                ...options.providerOptions,
                webSocketConstructor: createWebSocketConstructor(agentWire),
                wsBaseUrl: `ws://127.0.0.1:${input.relayPort ?? first.address.port}`,
              },
            });
            agentSessions.push(agent);
            return agent;
          },
        },
        generator: {
          generate: async () => ({
            generationId: `${input.id}:generation:1`,
            model: 'node-two-rounds-model',
            provider: 'node-two-rounds-provider',
            replacementBlock: { kind: 'source' as const, source: input.replacement },
          }),
        },
        logger: {
          error: (message) => workerErrors.push(String(message)),
          info: () => undefined,
          warn: () => undefined,
        },
        requestService: store.lifecycle,
        workerId: `${WORKER_ID}-${input.turnIndex}`,
      });
      const result = await worker.process({ attempt: 1, requestId: input.id });
      return { request, result, workerErrors };
    };

    const firstRound = await runNodeWorker({
      id: `${REQUEST_ID}-node-round-1`,
      relayPort: second.address.port,
      replacement: '<main>Lease Verified</main>',
      source: initialSource,
      turnIndex: 1,
    });
    expect(firstRound.result, firstRound.workerErrors.join(' | ')).toMatchObject({
      status: 'applied',
    });
    await waitForEditor(
      browser,
      () => readNodeSource(browser, nodeId) === '<main>Lease Verified</main>',
      'first node rewrite without reload',
    );

    const secondRound = await runNodeWorker({
      id: `${REQUEST_ID}-node-round-2`,
      parentRequestId: firstRound.request.id,
      relayPort: second.address.port,
      replacement: '<main>Continuation Verified</main>',
      source: '<main>Lease Verified</main>',
      turnIndex: 2,
    });
    expect(secondRound.result.status).toBe('applied');
    await waitForEditor(
      browser,
      () => readNodeSource(browser, nodeId) === '<main>Continuation Verified</main>',
      'continuation node rewrite without reload',
    );
    expect(readNodeSource(browser, nodeId)).toBe('<main>Continuation Verified</main>');
  }, 45_000);

  it('runs cross-segment rewrite through real browser bindings and a Node worker, then reloads the immutable persisted snapshot', async () => {
    const browserTickets = new DocumentCollaborationBrowserTicketService({
      secret: BROWSER_SECRET,
    });
    const agentTickets = new DocumentRewriteRoomTicketService({ secret: AGENT_SECRET });
    const browserTicketA = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const browserTicketB = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const repository = new MemoryPersistenceRepository();
    const persistence = makePersistence(repository);
    const first = await createServer({
      agentTickets,
      browserTickets,
      onRoomUpdate: (event) => {
        persistedEvents.push({
          ...event,
          snapshot: {
            stateVector: new Uint8Array(event.snapshot.stateVector),
            update: new Uint8Array(event.snapshot.update),
          },
        });
        return persistence.onRoomUpdate(event);
      },
    });

    const browserA = createBrowser({
      label: 'browser-a',
      port: first.address.port,
      shouldBootstrap: true,
      ticket: browserTicketA,
    });
    await hydrateBrowserAndWaitForSync(
      browserA,
      'Alpha segment to rewrite\n\nBeta segment to rewrite',
    );
    const browserB = createBrowser({
      label: 'browser-b',
      port: first.address.port,
      shouldBootstrap: false,
      ticket: browserTicketB,
    });
    await hydrateBrowserAndWaitForSync(browserB, null);
    await waitForEditor(
      browserB,
      () => readRootText(browserB) === readRootText(browserA),
      'initial shared text',
    );

    // Match the browser's Cmd/Ctrl+A path: the selection includes both full
    // top-level paragraphs, exercising boundary whitespace/hash persistence.
    selectCrossSegmentText(browserA, true);
    const selection = captureCollaborativeRewriteSelection(browserA.editor.kernel, {
      capturedAt: '2026-08-29T00:00:00.000Z',
      roomId: ROOM_ID,
    });
    expect(selection?.kind).toBe('relative');
    if (!selection || selection.kind !== 'relative') throw new Error('Missing relative selection');
    expect(selection.targetNodeIds).toHaveLength(2);
    expect(selection.quotedTextHash).toBe(hashRewriteText(selection.quotedText));
    expect(JSON.stringify(selection)).not.toMatch(/nodeKey/i);

    const requestStore = createLifecycle(
      makeRequest(toRequestSelection(selection)),
      agentTickets,
      () => repository.history.some((entry) => entry.requestId === REQUEST_ID),
    );
    expect(JSON.stringify(requestStore.request)).not.toMatch(/nodeKey/i);
    const thinking = new Deferred<void>();
    const releaseGenerator = new Deferred<void>();
    const agentWire: string[] = [];
    const streamedAppendTexts: string[] = [];
    let generatorInput: RewriteGeneratorInput | undefined;
    const generator = {
      generateStream: async (
        input: RewriteGeneratorInput,
        onChunk: RewriteGeneratorChunkHandler,
      ) => {
        generatorInput = input;
        thinking.resolve();
        await releaseGenerator.promise;
        await onChunk.onStart?.({
          generationId: 'phase6-generation',
          model: 'fake-rewrite-model',
          provider: 'fake-rewrite-provider',
        });
        const chunks = ['A concise ', 'cross-segment ', 'rewrite.'];
        for (const [index, text] of chunks.entries()) {
          await onChunk({
            chunkId: `phase6-generation:chunk:${index + 1}`,
            sequence: index + 1,
            text,
          });
          if (index < chunks.length - 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 45));
          }
        }
        return {
          generationId: 'phase6-generation',
          model: 'fake-rewrite-model',
          provider: 'fake-rewrite-provider',
          replacementText: 'A concise cross-segment rewrite.',
        };
      },
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: {
        create: async (options: CollaborativeAgentEditorConnectOptions) => {
          const agent = await CollaborativeAgentEditor.create({
            ...options,
            providerOptions: {
              ...options.providerOptions,
              webSocketConstructor: createWebSocketConstructor(agentWire),
              wsBaseUrl: `ws://127.0.0.1:${first.address.port}`,
            },
          });
          const startStreamingRewrite = agent.startStreamingRewrite.bind(agent);
          agent.startStreamingRewrite = async (input) => {
            const session = await startStreamingRewrite(input);
            const append = session.append.bind(session);
            session.append = async (chunk) => {
              streamedAppendTexts.push(chunk.text ?? chunk.chunk ?? '');
              return append(chunk);
            };
            return session;
          };
          return agent;
        },
      },
      generator,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      requestService: requestStore.lifecycle,
      workerId: WORKER_ID,
    });

    const workerRun = worker.process({ attempt: 1, requestId: REQUEST_ID });
    await thinking.promise;
    await Promise.all([
      waitForAwareness(browserA, 'thinking'),
      waitForAwareness(browserB, 'thinking'),
    ]);
    expect(generatorInput?.targetNodeIds).toEqual(selection.targetNodeIds);
    expect(generatorInput?.quotedText).toBe(selection.quotedText);
    expect(JSON.stringify(generatorInput)).not.toMatch(/nodeKey/i);
    expect(requestStore.request.status).toBe('thinking');
    const agentUpdateCountBeforeRewrite = agentWire
      .map((payload) => JSON.parse(payload) as { type?: string })
      .filter((message) => message.type === 'update').length;

    const writingAwareness = Promise.all([
      waitForAwareness(browserA, 'writing'),
      waitForAwareness(browserB, 'writing'),
    ]);
    releaseGenerator.resolve();
    const workerResult = await workerRun;
    await writingAwareness;
    expect(workerResult.status).toBe('applied');
    expect(requestStore.request.status).toBe('applied');
    await Promise.all([
      waitForEditor(
        browserA,
        () => readRootText(browserA).includes('A concise cross-segment rewrite.'),
        'direct rewrite final text on browser A',
      ),
      waitForEditor(
        browserB,
        () => readRootText(browserB).includes('A concise cross-segment rewrite.'),
        'direct rewrite final text on browser B',
      ),
    ]);
    expect(streamedAppendTexts.join('')).toBe('A concise cross-segment rewrite.');
    expect(JSON.stringify(browserA.editor.export().editorData)).toContain('phase6-generation');
    expect(JSON.stringify(browserB.editor.export().editorData)).toContain('phase6-generation');
    const agentUpdateMessages = agentWire
      .map((payload) => JSON.parse(payload) as { type?: string })
      .filter((message) => message.type === 'update');
    expect(agentUpdateMessages.length).toBeGreaterThanOrEqual(agentUpdateCountBeforeRewrite + 2);
    expect(
      browserA.wire.concat(browserB.wire, agentWire).every((payload) => !/nodeKey/i.test(payload)),
    ).toBe(true);

    expect(readRootText(browserA)).toBe(readRootText(browserB));
    expect(hasPendingDiff(browserA)).toBe(false);
    expect(hasPendingDiff(browserB)).toBe(false);

    browserA.provider.disconnect();
    const browserReconnect = browserA.provider.waitForSync();
    browserA.provider.connect();
    await browserReconnect;
    await waitForEditor(
      browserA,
      () => readRootText(browserA) === readRootText(browserB),
      'browser reconnect state',
    );

    await first.server.flushRoom(ROOM_ID, 'direct-apply');
    expect(persistedEvents.at(-1)?.snapshot.update).toBeInstanceOf(Uint8Array);
    expect(persistedEvents.at(-1)?.snapshot.stateVector).toBeInstanceOf(Uint8Array);
    expect(repository.projection?.markdown).toContain('A concise cross-segment rewrite.');
    expect(repository.history.some((entry) => entry.requestId === REQUEST_ID)).toBe(true);
    expect(repository.history.some((entry) => entry.source === 'agent_collaboration')).toBe(true);
    const persistedRoomSnapshot = persistedEvents.at(-1)?.snapshot;
    if (!persistedRoomSnapshot) throw new Error('Expected an immutable persisted room snapshot.');
    const reloadedProjection = await (
      await import('@lobehub/editor/headless')
    ).exportYjsSnapshotProjection({
      roomId: ROOM_ID,
      update: new Uint8Array(persistedRoomSnapshot.update),
    });
    expect(reloadedProjection.markdown).toContain('concise cross-segment');
    const persistedEditorData = repository.projection?.editorData;
    if (!persistedEditorData) throw new Error('Expected an immutable persisted editor projection.');
    expect(JSON.stringify(persistedEditorData)).not.toMatch(/nodeKey/i);

    const persistedSnapshot = structuredClone(
      persistedEditorData,
    ) as unknown as SerializedEditorState<SerializedLexicalNode>;
    browserA.provider.disconnect();
    browserB.provider.disconnect();
    browserA.editor.destroy();
    browserB.editor.destroy();
    browserClients.splice(0, browserClients.length);
    editors.splice(0, editors.length);
    await first.server.close();
    servers.splice(servers.indexOf(first.server), 1);

    const second = await createServer({
      agentTickets,
      browserTickets,
      onRoomUpdate: (event) => persistence.onRoomUpdate(event),
    });
    const reloadA = createBrowser({
      label: 'browser-reload-a',
      port: second.address.port,
      shouldBootstrap: true,
      ticket: browserTicketA,
    });
    await hydrateBrowserAndWaitForSync(reloadA, persistedSnapshot);
    const reloadB = createBrowser({
      label: 'browser-reload-b',
      port: second.address.port,
      shouldBootstrap: false,
      ticket: browserTicketB,
    });
    await hydrateBrowserAndWaitForSync(reloadB, null);
    await waitForEditor(
      reloadB,
      () => readRootText(reloadB) === readRootText(reloadA),
      'reloaded shared text',
    );
    expect(readRootText(reloadA)).toContain('concise cross-segment');
    expect(readRootText(reloadB)).toBe(readRootText(reloadA));
    expect(hasPendingDiff(reloadA)).toBe(false);
    expect(hasPendingDiff(reloadB)).toBe(false);
  }, 45_000);

  it('runs five disjoint Agent streams in one room, rejects the sixth, and isolates cancellation', async () => {
    const browserTickets = new DocumentCollaborationBrowserTicketService({
      secret: `${BROWSER_SECRET}-five-agents`,
    });
    const agentTickets = new DocumentRewriteRoomTicketService({
      secret: `${AGENT_SECRET}-five-agents`,
    });
    const browserTicket = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const repository = new MemoryPersistenceRepository();
    const persistence = makePersistence(repository);
    const server = await createServer({
      agentTickets,
      browserTickets,
      maxBrowserClients: 1,
      onRoomUpdate: (event) => {
        persistedEvents.push({
          ...event,
          snapshot: {
            stateVector: new Uint8Array(event.snapshot.stateVector),
            update: new Uint8Array(event.snapshot.update),
          },
        });
        return persistence.onRoomUpdate(event);
      },
    });
    const browser = createBrowser({
      label: 'five-agents-browser',
      port: server.address.port,
      shouldBootstrap: true,
      ticket: browserTicket,
    });
    await hydrateBrowserAndWaitForSync(
      browser,
      [
        'Alpha paragraph for Agent one',
        'Beta paragraph for Agent two',
        'Gamma paragraph for Agent three',
        'Delta paragraph for Agent four',
        'Epsilon paragraph for Agent five',
        'Zeta paragraph remains untouched',
      ].join('\n\n'),
    );

    const selections: DocumentRewriteSelection[] = [];
    for (let index = 0; index < 5; index += 1) {
      selectParagraphText(browser, index);
      const captured = captureCollaborativeRewriteSelection(browser.editor.kernel, {
        capturedAt: `2026-08-31T00:00:0${index}.000Z`,
        roomId: ROOM_ID,
      });
      expect(captured?.kind).toBe('relative');
      if (!captured || captured.kind !== 'relative') {
        throw new Error(`Missing relative selection for Agent ${index + 1}`);
      }
      const selection = toRequestSelection(captured);
      expect(selection.targetNodeIds).toHaveLength(1);
      selections.push(selection);
    }
    expect(new Set(selections.flatMap((selection) => selection.targetNodeIds ?? [])).size).toBe(5);

    const requestIds = selections.map((_, index) => `${REQUEST_ID}-five-${index}`);
    const stores = selections.map((selection, index) =>
      createLifecycle({ ...makeRequest(selection), id: requestIds[index]! }, agentTickets, () =>
        repository.history.some((entry) => entry.requestId === requestIds[index]),
      ),
    );
    const thinking = selections.map(() => new Deferred<void>());
    const releaseGenerators = new Deferred<void>();
    const agentWires: string[][] = selections.map(() => []);
    const expectedReplacements = selections.map(
      (_, index) => `Agent ${index + 1} rewrote this paragraph`,
    );

    const workers = selections.map((selection, index) => {
      const requestId = requestIds[index]!;
      const generationId = `${requestId}:generation:1`;
      const replacementText = expectedReplacements[index]!;
      return new DocumentRewriteWorker({
        editorFactory: {
          create: async (options: CollaborativeAgentEditorConnectOptions) => {
            const agent = await CollaborativeAgentEditor.create({
              ...options,
              providerOptions: {
                ...options.providerOptions,
                webSocketConstructor: createWebSocketConstructor(agentWires[index]!),
                wsBaseUrl: `ws://127.0.0.1:${server.address.port}`,
              },
            });
            agentSessions.push(agent);
            return agent;
          },
        },
        generator: {
          generateStream: async (
            input: RewriteGeneratorInput,
            onChunk: RewriteGeneratorChunkHandler,
          ): Promise<RewriteGeneratorOutput> => {
            thinking[index]!.resolve();
            await releaseGenerators.promise;
            // Cancellation is checked before opening a streaming session, so
            // this request never creates a marker or room update.
            if (input.signal.aborted || stores[index]!.request.status === 'cancel_requested') {
              return {
                generationId,
                model: `parallel-model-${index}`,
                provider: 'parallel-test-provider',
                replacementText: '',
              };
            }
            await onChunk.onStart?.({
              generationId,
              model: `parallel-model-${index}`,
              provider: 'parallel-test-provider',
            });
            const splitAt = Math.max(1, Math.floor(replacementText.length / 2));
            for (const [sequence, text] of [
              replacementText.slice(0, splitAt),
              replacementText.slice(splitAt),
            ].entries()) {
              await onChunk({
                chunkId: `${generationId}:chunk:${sequence + 1}`,
                sequence: sequence + 1,
                text,
              });
              await new Promise<void>((resolve) => setTimeout(resolve, 2));
            }
            return {
              generationId,
              model: `parallel-model-${index}`,
              provider: 'parallel-test-provider',
              replacementText,
            };
          },
        },
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        requestService: stores[index]!.lifecycle,
        streamingGraphemeBatchSize: 4,
        streamingGraphemePacingMs: 35,
        workerId: `${WORKER_ID}-five-${index}`,
      });
    });

    const runs = workers.map((worker, index) =>
      worker.process({ attempt: 1, requestId: requestIds[index]! }),
    );
    await Promise.all(thinking.map((barrier) => barrier.promise));
    await Promise.all(
      requestIds.map((requestId) => waitForAwareness(browser, 'thinking', requestId)),
    );
    expect(
      Array.from(browser.provider.awareness.getStates().values()).filter(
        (state) =>
          (state as { awarenessData?: { status?: string } }).awarenessData?.status === 'thinking',
      ),
    ).toHaveLength(5);

    // Room capacity is independently enforced even when a caller attempts to
    // open a sixth Agent session directly. The durable request-create path is
    // covered by the PGlite Promise.all capacity test.
    const sixthRequestId = `${REQUEST_ID}-five-sixth`;
    const sixthTicket = agentTickets.issue({
      agentId: AGENT_ID,
      attempt: 1,
      documentId: DOCUMENT_ID,
      requestId: sixthRequestId,
      roomId: ROOM_ID,
      userId: USER_ID,
      workerId: `${WORKER_ID}-five-sixth`,
      workspaceId: WORKSPACE_ID,
    });
    const sixthSession = CollaborativeAgentEditor.create({
      documentId: DOCUMENT_ID,
      providerOptions: {
        webSocketConstructor: createWebSocketConstructor([]),
        wsBaseUrl: `ws://127.0.0.1:${server.address.port}`,
      },
      requestId: sixthRequestId,
      roomId: ROOM_ID,
      ticket: sixthTicket,
    });
    await expect(sixthSession.connect()).rejects.toThrow(/at most 5 Agent clients/i);
    await sixthSession.disconnect();

    stores[0]!.cancel();
    releaseGenerators.resolve();
    const results = await Promise.all(runs);
    expect(results[0]).toMatchObject({ status: 'canceled' });
    expect(results.slice(1).every((result) => result.status === 'applied')).toBe(true);
    expect(stores[0]!.request.status).toBe('canceled');
    expect(stores.slice(1).every((store) => store.request.status === 'applied')).toBe(true);

    await waitForEditor(
      browser,
      () =>
        expectedReplacements
          .slice(1)
          .every((replacement) => readRootText(browser).includes(replacement)) &&
        readRootText(browser).includes('Alpha paragraph for Agent one'),
      'five independent stream results',
    );
    expect(readRootText(browser)).toContain('Zeta paragraph remains untouched');
    expect(hasPendingDiff(browser)).toBe(false);
    expect(hasStreamingRegionMarker(browser)).toBe(false);
    expect(
      requestIds
        .slice(1)
        .every((requestId) => repository.history.some((entry) => entry.requestId === requestId)),
    ).toBe(true);
    expect(repository.history.some((entry) => entry.requestId === requestIds[0])).toBe(false);
    expect(persistedEvents.length).toBeGreaterThan(0);
    expect(
      persistedEvents.some((event) =>
        requestIds.slice(1).every((id) => event.requestIds.includes(id)),
      ),
    ).toBe(true);
  }, 45_000);

  it('cancels a live stream when a peer deletes the protected target block', async () => {
    const browserTickets = new DocumentCollaborationBrowserTicketService({
      secret: `${BROWSER_SECRET}-stream-delete`,
    });
    const agentTickets = new DocumentRewriteRoomTicketService({
      secret: `${AGENT_SECRET}-stream-delete`,
    });
    const browserTicketA = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const browserTicketB = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const repository = new MemoryPersistenceRepository();
    const persistence = makePersistence(repository);
    const server = await createServer({
      agentTickets,
      browserTickets,
      onRoomUpdate: (event) => persistence.onRoomUpdate(event),
    });
    const browserA = createBrowser({
      label: 'stream-delete-a',
      port: server.address.port,
      shouldBootstrap: true,
      ticket: browserTicketA,
    });
    await hydrateBrowserAndWaitForSync(
      browserA,
      'Alpha segment to rewrite\n\nBeta segment to rewrite\n\nTail paragraph remains',
    );
    const browserB = createBrowser({
      label: 'stream-delete-b',
      port: server.address.port,
      shouldBootstrap: false,
      ticket: browserTicketB,
    });
    await hydrateBrowserAndWaitForSync(browserB, null);
    await waitForEditor(
      browserB,
      () => readRootText(browserB) === readRootText(browserA),
      'stream deletion bootstrap',
    );

    selectCrossSegmentText(browserA, true);
    const captured = captureCollaborativeRewriteSelection(browserA.editor.kernel, {
      capturedAt: '2026-08-31T00:00:00.000Z',
      roomId: ROOM_ID,
    });
    expect(captured?.kind).toBe('relative');
    if (!captured || captured.kind !== 'relative') throw new Error('Missing relative selection');
    const requestId = `${REQUEST_ID}-stream-delete`;
    const requestStore = createLifecycle(
      {
        ...makeRequest(toRequestSelection(captured)),
        id: requestId,
      },
      agentTickets,
    );
    const thinking = new Deferred<void>();
    const firstChunk = new Deferred<void>();
    const releaseAfterDelete = new Deferred<void>();
    const agentWire: string[] = [];
    let agentSession: CollaborativeAgentEditor | undefined;
    const generator = {
      generateStream: async (
        _input: RewriteGeneratorInput,
        onChunk: RewriteGeneratorChunkHandler,
      ) => {
        thinking.resolve();
        await onChunk.onStart?.({
          generationId: `${requestId}:generation:1`,
          model: 'fake-stream-delete-model',
          provider: 'fake-stream-delete-provider',
        });
        await onChunk({ chunkId: 'stream-delete-chunk-1', sequence: 1, text: 'Partial' });
        firstChunk.resolve();
        await releaseAfterDelete.promise;
        // The peer deletion makes this append return region_missing. The
        // worker must abort the model and never allow this late token through.
        await onChunk({
          chunkId: 'stream-delete-chunk-2',
          sequence: 2,
          text: ' never resurrect',
        });
        return {
          generationId: `${requestId}:generation:1`,
          model: 'fake-stream-delete-model',
          provider: 'fake-stream-delete-provider',
          replacementText: 'Partial never resurrect',
        };
      },
    };
    const worker = new DocumentRewriteWorker({
      editorFactory: {
        create: async (options: CollaborativeAgentEditorConnectOptions) => {
          agentSession = await CollaborativeAgentEditor.create({
            ...options,
            requestId,
            providerOptions: {
              ...options.providerOptions,
              webSocketConstructor: createWebSocketConstructor(agentWire),
              wsBaseUrl: `ws://127.0.0.1:${server.address.port}`,
            },
          });
          return agentSession;
        },
      },
      generator,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      requestService: requestStore.lifecycle,
      streamingFlushMs: 30,
      workerId: `${WORKER_ID}-stream-delete`,
    });

    const workerRun = worker.process({ attempt: 1, requestId: requestStore.request.id });
    await thinking.promise;
    await firstChunk.promise;
    await waitForEditor(
      browserB,
      () => readRootText(browserB).includes('Partial'),
      'first streamed chunk on peer',
    );
    if (!agentSession) throw new Error('Worker did not create an Agent session.');
    const agentDeletionUpdate = waitForAgentUpdate(agentSession);
    browserB.lexical.update(
      () => {
        $getRoot().getFirstChild()?.remove();
      },
      { discrete: true },
    );
    await waitForEditor(
      browserA,
      () => !readRootText(browserA).includes('Partial'),
      'deleted protected target on Agent peer',
    );
    await agentDeletionUpdate;
    releaseAfterDelete.resolve();

    const result = await workerRun;
    expect(result).toMatchObject({
      reason: 'DOCUMENT_REWRITE_WORKER_REGION_MISSING',
      status: 'canceled_after_write',
    });
    expect(requestStore.request.status).toBe('canceled_after_write');
    await Promise.all([
      waitForEditor(
        browserA,
        () => !readRootText(browserA).includes('never resurrect'),
        'no resurrected late token on browser A',
      ),
      waitForEditor(
        browserB,
        () => !readRootText(browserB).includes('never resurrect'),
        'no resurrected late token on browser B',
      ),
    ]);
    expect(hasPendingDiff(browserA)).toBe(false);
    expect(hasPendingDiff(browserB)).toBe(false);
  }, 30_000);

  it('reconnects a real Agent with a fresh HMAC ticket and rejects replay of the consumed ticket', async () => {
    const browserTickets = new DocumentCollaborationBrowserTicketService({
      secret: `${BROWSER_SECRET}-agent-reconnect`,
    });
    const agentTickets = new DocumentRewriteRoomTicketService({
      secret: `${AGENT_SECRET}-agent-reconnect`,
    });
    const browserTicket = browserTickets.issue({
      documentId: DOCUMENT_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      onRoomUpdate: async () => undefined,
      roomUpdateDebounceMs: 5,
      ticketVerifier: createUnifiedVerifier(browserTickets, agentTickets),
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = createBrowser({
      label: 'agent-reconnect-browser',
      port: address.port,
      shouldBootstrap: true,
      ticket: browserTicket,
    });
    await hydrateBrowserAndWaitForSync(browser, 'Persistent room content');

    const ticketOne = agentTickets.issue({
      agentId: AGENT_ID,
      attempt: 1,
      documentId: DOCUMENT_ID,
      requestId: `${REQUEST_ID}-reconnect-1`,
      roomId: ROOM_ID,
      userId: USER_ID,
      workerId: WORKER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const sessionOne = CollaborativeAgentEditor.create({
      documentId: DOCUMENT_ID,
      providerOptions: {
        webSocketConstructor: createWebSocketConstructor([]),
        wsBaseUrl: `ws://127.0.0.1:${address.port}`,
      },
      requestId: `${REQUEST_ID}-reconnect-1`,
      roomId: ROOM_ID,
      ticket: ticketOne,
    });
    agentSessions.push(sessionOne);
    await sessionOne.connect();
    const firstStateVector = sessionOne.getStateVector();
    await sessionOne.disconnect();
    agentSessions.splice(agentSessions.indexOf(sessionOne), 1);

    const ticketTwo = agentTickets.issue({
      agentId: AGENT_ID,
      attempt: 1,
      documentId: DOCUMENT_ID,
      requestId: `${REQUEST_ID}-reconnect-2`,
      roomId: ROOM_ID,
      userId: USER_ID,
      workerId: WORKER_ID,
      workspaceId: WORKSPACE_ID,
    });
    const sessionTwo = CollaborativeAgentEditor.create({
      documentId: DOCUMENT_ID,
      providerOptions: {
        webSocketConstructor: createWebSocketConstructor([]),
        wsBaseUrl: `ws://127.0.0.1:${address.port}`,
      },
      requestId: `${REQUEST_ID}-reconnect-2`,
      roomId: ROOM_ID,
      ticket: ticketTwo,
    });
    agentSessions.push(sessionTwo);
    await sessionTwo.connect();
    expect(sessionTwo.getStateVector()).toBe(firstStateVector);
    expect(sessionTwo.getStateVector()).toBe(browser.provider.getStateVector());

    const replay = CollaborativeAgentEditor.create({
      documentId: DOCUMENT_ID,
      providerOptions: {
        webSocketConstructor: createWebSocketConstructor([]),
        wsBaseUrl: `ws://127.0.0.1:${address.port}`,
      },
      requestId: `${REQUEST_ID}-reconnect-1`,
      roomId: ROOM_ID,
      ticket: ticketOne,
    });
    await expect(replay.connect()).rejects.toThrow(/already been used|authentication/i);
    await replay.disconnect();
  }, 30_000);

  it.each([
    ['anchor deletion', 'canceled'],
    ['human edit during thinking', 'stale'],
    ['cancellation while thinking', 'canceled'],
  ] as const)(
    'does not write a Diff when %s wins the worker race',
    async (_scenario, expectedStatus) => {
      const browserTickets = new DocumentCollaborationBrowserTicketService({
        secret: `${BROWSER_SECRET}-failure`,
      });
      const agentTickets = new DocumentRewriteRoomTicketService({
        secret: `${AGENT_SECRET}-failure`,
      });
      const browserTicketA = browserTickets.issue({
        documentId: DOCUMENT_ID,
        roomId: ROOM_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
      });
      const browserTicketB = browserTickets.issue({
        documentId: DOCUMENT_ID,
        roomId: ROOM_ID,
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
      });
      const server = createCollaborationServer({
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        maxBrowserClients: 2,
        onRoomUpdate: async () => undefined,
        roomUpdateDebounceMs: 5,
        ticketVerifier: createUnifiedVerifier(browserTickets, agentTickets),
      });
      servers.push(server);
      const address = await server.listen(0);
      const browserA = createBrowser({
        label: `failure-${_scenario}-a`,
        port: address.port,
        shouldBootstrap: true,
        ticket: browserTicketA,
      });
      await hydrateBrowserAndWaitForSync(
        browserA,
        'Alpha segment to rewrite\n\nBeta segment to rewrite\n\nTail paragraph remains',
      );
      const browserB = createBrowser({
        label: `failure-${_scenario}-b`,
        port: address.port,
        shouldBootstrap: false,
        ticket: browserTicketB,
      });
      await hydrateBrowserAndWaitForSync(browserB, null);
      await waitForEditor(
        browserB,
        () => readRootText(browserB) === readRootText(browserA),
        'failure scenario bootstrap',
      );

      selectCrossSegmentText(browserA);
      const selection = captureCollaborativeRewriteSelection(browserA.editor.kernel, {
        capturedAt: '2026-08-29T00:00:00.000Z',
        roomId: ROOM_ID,
      });
      expect(selection?.kind).toBe('relative');
      if (!selection || selection.kind !== 'relative') throw new Error('Missing failure selection');
      const requestStore = createLifecycle(
        makeRequest(toRequestSelection(selection)),
        agentTickets,
      );
      const thinking = new Deferred<void>();
      const releaseGenerator = new Deferred<void>();
      const agentWire: string[] = [];
      let agentSession: CollaborativeAgentEditor | undefined;
      const worker = new DocumentRewriteWorker({
        editorFactory: {
          create: (options: CollaborativeAgentEditorConnectOptions) => {
            agentSession = CollaborativeAgentEditor.create({
              ...options,
              providerOptions: {
                ...options.providerOptions,
                webSocketConstructor: createWebSocketConstructor(agentWire),
                wsBaseUrl: `ws://127.0.0.1:${address.port}`,
              },
            });
            return agentSession;
          },
        },
        generator: {
          generate: async (): Promise<RewriteGeneratorOutput> => {
            thinking.resolve();
            await releaseGenerator.promise;
            return { replacementText: 'must not be written' };
          },
        },
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        requestService: requestStore.lifecycle,
        workerId: WORKER_ID,
      });
      const workerRun = worker.process({ attempt: 1, requestId: REQUEST_ID });
      await thinking.promise;

      if (_scenario !== 'cancellation while thinking') {
        if (!agentSession) throw new Error('Worker did not create an Agent session.');
        const agentUpdate = waitForAgentUpdate(agentSession);
        if (_scenario === 'anchor deletion') {
          browserA.lexical.update(
            () => {
              $getRoot()
                .getChildren()
                .slice(0, 2)
                .forEach((node) => node.remove());
            },
            { discrete: true },
          );
        } else {
          browserA.lexical.update(
            () => {
              const first = $getRoot().getFirstChild();
              const text = first && $isElementNode(first) ? first.getFirstChild() : null;
              if (!$isTextNode(text)) throw new Error('Missing text node for human edit.');
              text.setTextContent('Human edit changed the anchor.');
            },
            { discrete: true },
          );
        }
        await waitForEditor(
          browserB,
          () =>
            _scenario === 'anchor deletion'
              ? readRootText(browserB) === 'Tail paragraph remains'
              : readRootText(browserB).startsWith('Human edit changed'),
          _scenario === 'anchor deletion'
            ? 'deleted anchor on browser B'
            : 'human edit on browser B',
        );
        await agentUpdate;
      } else {
        requestStore.cancel();
      }
      releaseGenerator.resolve();

      const result = await workerRun;
      expect(result.status).toBe(expectedStatus);
      expect(requestStore.request.status).toBe(expectedStatus);
      await waitForEditor(browserA, () => !hasPendingDiff(browserA), 'no local failure Diff');
      await waitForEditor(browserB, () => !hasPendingDiff(browserB), 'no remote failure Diff');
      expect(
        browserA.wire
          .concat(browserB.wire, agentWire)
          .every((payload) => !/nodeKey/i.test(payload)),
      ).toBe(true);
    },
    30_000,
  );
});
