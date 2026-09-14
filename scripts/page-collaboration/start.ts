import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { sql } from 'drizzle-orm';

import type {
  DocumentCollaborationBrowserTicketClaims,
  DocumentCollaborationBrowserTicketService,
} from '../../apps/server/src/services/documentCollaboration/browserTicket';
import {
  createDocumentCollaborationRoomTicketVerifier,
  DocumentCollaborationBrowserTicketService as BrowserTicketService,
} from '../../apps/server/src/services/documentCollaboration/browserTicket';
import type { CollaborationRoomPersistenceEvent } from '../../apps/server/src/services/documentCollaboration/persistence';
import type { DocumentRewriteRoomTicketClaims } from '../../apps/server/src/services/documentRewrite/roomTicket';
import { DocumentRewriteRoomTicketService } from '../../apps/server/src/services/documentRewrite/roomTicket';
import {
  createDatabaseDocumentRewriteTicketAuthorizer,
  createDocumentRewriteRoomTicketVerifier,
} from '../../apps/server/src/services/documentRewrite/service';
import { assertCanPerformResourceAction } from '../../apps/server/src/services/resourcePermission';
import { DocumentModel } from '../../packages/database/src/models/document';
import {
  DOCUMENT_COLLABORATION_SNAPSHOT_MISSING,
  DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH,
  DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN,
  DocumentCollaborationStateModel,
} from '../../packages/database/src/models/documentCollaborationState';
import type { LobeChatDatabase } from '../../packages/database/src/type';
import { assertAgentUsableBy } from '../../packages/database/src/utils/agent-access';
import { type CollaborationRoomScope, createPageCollaborationRoomBackend } from './roomBackend';

const require = createRequire(import.meta.url);

/**
 * Make the ESM Yjs constructors authoritative before the CommonJS relay is
 * loaded. Yjs intentionally warns when both `dist/yjs.mjs` and
 * `dist/yjs.cjs` are evaluated in one process because `instanceof` checks then
 * become unreliable. This bridge is process-local and contains no document
 * state or credentials.
 */
export const installPageCollaborationYjsSingleton = async (): Promise<void> => {
  // Keep this a native dynamic import. In the tsx CommonJS composition root,
  // a static `import 'yjs'` is transpiled to `require('yjs')` (CJS), while the
  // editor/headless graph uses the ESM export. Dynamic import selects the same
  // ESM module identity as @lobehub/editor.
  const yjs = await import('yjs');
  const runtime = globalThis as typeof globalThis & {
    __LOBE_PAGE_YJS__?: typeof yjs;
  };
  runtime.__LOBE_PAGE_YJS__ ??= yjs;
  if (runtime.__LOBE_PAGE_YJS__ !== yjs) {
    throw new Error('Page collaboration loaded multiple Yjs module identities');
  }
};

/** Load the same env layers as Next before importing the DB adapter. */
export const loadPageCollaborationEnvironment = (): void => {
  const environment = process.env.NODE_ENV || 'development';
  dotenvExpand.expand(dotenv.config());
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}` }));
  dotenvExpand.expand(dotenv.config({ override: true, path: '.env.local' }));
  dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}.local` }));
};

export interface PageCollaborationCompositionOptions {
  agentTicketService?: DocumentRewriteRoomTicketService;
  authorizeAgent?: (claims: DocumentRewriteRoomTicketClaims) => boolean | Promise<boolean>;
  authorizeBrowser?: (
    claims: DocumentCollaborationBrowserTicketClaims,
  ) => boolean | Promise<boolean>;
  browserTicketService?: DocumentCollaborationBrowserTicketService;
  persistenceWorker?: {
    onRoomUpdate: (event: CollaborationRoomPersistenceEvent) => unknown;
  };
}

const assertDocumentAccessForRoom = async (input: {
  action: 'edit' | 'view';
  db: LobeChatDatabase;
  documentId: string;
  userId: string;
  workspaceId: string | null;
}): Promise<boolean> => {
  try {
    if (input.workspaceId) {
      await assertCanPerformResourceAction({
        action: input.action,
        db: input.db,
        resourceId: input.documentId,
        resourceType: 'document',
        userId: input.userId,
        workspaceId: input.workspaceId,
      });
      return true;
    }

    return Boolean(await new DocumentModel(input.db, input.userId).findById(input.documentId));
  } catch {
    return false;
  }
};

const defaultAuthorizeBrowser =
  (db: LobeChatDatabase) =>
  async (claims: DocumentCollaborationBrowserTicketClaims): Promise<boolean> => {
    if (claims.roomId !== claims.documentId) return false;
    return assertDocumentAccessForRoom({
      action: claims.canWrite ? 'edit' : 'view',
      db,
      documentId: claims.documentId,
      userId: claims.userId,
      workspaceId: claims.workspaceId,
    });
  };

const defaultAuthorizeAgent = (db: LobeChatDatabase) => {
  const authorizeRequest = createDatabaseDocumentRewriteTicketAuthorizer(db);
  return async (claims: DocumentRewriteRoomTicketClaims): Promise<boolean> => {
    if (!claims.workerId || claims.roomId !== claims.documentId) return false;
    if (!(await authorizeRequest(claims))) return false;

    if (
      !(await assertDocumentAccessForRoom({
        action: 'edit',
        db,
        documentId: claims.documentId,
        userId: claims.userId,
        workspaceId: claims.workspaceId,
      }))
    ) {
      return false;
    }

    try {
      await assertAgentUsableBy(db, claims.agentId, {
        userId: claims.userId,
        workspaceId: claims.workspaceId ?? undefined,
      });
      return true;
    } catch {
      return false;
    }
  };
};

/**
 * Compose the two room capability families and a tenant-aware persistence
 * callback. Browser tickets are reusable and never carry request/worker
 * claims; Agent tickets remain single-use and lease-bound.
 */
export const createPageCollaborationComposition = (
  db: LobeChatDatabase,
  options: PageCollaborationCompositionOptions = {},
) => {
  const browserTicketService = options.browserTicketService ?? new BrowserTicketService();
  const agentTicketService = options.agentTicketService ?? new DocumentRewriteRoomTicketService();
  const agentVerifier = createDocumentRewriteRoomTicketVerifier({
    authorize: options.authorizeAgent ?? defaultAuthorizeAgent(db),
    ticketService: agentTicketService,
  });
  const ticketVerifier = createDocumentCollaborationRoomTicketVerifier({
    agentVerifier,
    browser: {
      authorize: options.authorizeBrowser ?? defaultAuthorizeBrowser(db),
      ticketService: browserTicketService,
    },
  });

  const onRoomUpdate = async (event: CollaborationRoomPersistenceEvent) => {
    if (!options.persistenceWorker) {
      throw new Error('Document collaboration persistence worker is not configured');
    }
    return options.persistenceWorker.onRoomUpdate(event);
  };

  return { onRoomUpdate, ticketVerifier };
};

export interface PageCollaborationServer {
  close: () => Promise<void>;
  listen: (port: number, host?: string) => Promise<{ port: number }>;
}

const BASE64_PATTERN = /^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i;

const decodeSnapshotBytes = (value: string, label: string): Uint8Array => {
  if (value.length % 4 === 1 || !BASE64_PATTERN.test(value)) {
    throw new Error(`${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: invalid ${label}`);
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
};

const snapshotFromVersion = (
  version: {
    roomId?: string;
    roomRevision: number;
    snapshotUpdate: string | null;
    stateVector: string;
  },
  roomId: string,
) => {
  if (version.roomId !== roomId || version.snapshotUpdate === null) {
    throw new Error(
      `${DOCUMENT_COLLABORATION_SNAPSHOT_MISSING}: durable room snapshot is unavailable`,
    );
  }
  return {
    revision: version.roomRevision,
    stateVector: decodeSnapshotBytes(version.stateVector, 'state vector'),
    update: decodeSnapshotBytes(version.snapshotUpdate, 'snapshot update'),
  };
};

/**
 * Load the exact persisted Yjs room snapshot, seeding only a never-seen
 * document. Rebuilding a Y.Doc from the JSON projection is deliberately not a
 * fallback: it creates new CRDT client IDs and can duplicate pending browser
 * deltas after a relay restart.
 */
export const createPageCollaborationRoomSnapshotLoader =
  (db: LobeChatDatabase) =>
  async ({ scope }: { scope: CollaborationRoomScope }) => {
    if (!scope.userId) return null;
    const workspaceId = scope.workspaceId ?? undefined;
    const document = await new DocumentModel(db, scope.userId, workspaceId).findById(
      scope.documentId,
    );
    if (!document) return null;

    const model = new DocumentCollaborationStateModel(db, scope.userId, workspaceId);
    const version = await model.readVersion(scope.documentId);
    if (version.versionToken !== DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN) {
      if (
        !version.persistedDocumentUpdatedAt ||
        version.persistedDocumentUpdatedAt.getTime() !== document.updatedAt.getTime()
      ) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: document projection is newer than the collaboration ledger`,
        );
      }
      return snapshotFromVersion(version, scope.roomId);
    }

    const { createImmutableRoomSnapshotFromEditorData } =
      await import('../../apps/server/src/services/documentCollaboration/headlessExporter');
    const candidate = await createImmutableRoomSnapshotFromEditorData({
      content: document.content,
      editorData: document.editorData,
      revision: version.roomRevision,
      roomId: scope.roomId,
    });
    const seeded = await model.ensureSnapshot({
      documentId: scope.documentId,
      expectedDocumentUpdatedAt: document.updatedAt,
      seed: {
        roomId: scope.roomId,
        roomRevision: candidate.revision,
        snapshotUpdate: Buffer.from(candidate.update).toString('base64'),
        stateVector: Buffer.from(candidate.stateVector).toString('base64'),
      },
    });
    return snapshotFromVersion(seeded.version, scope.roomId);
  };

export const startPageCollaborationServer = async (): Promise<PageCollaborationServer> => {
  loadPageCollaborationEnvironment();
  await installPageCollaborationYjsSingleton();
  const { migrateLegacyBlockImagesInYjsDoc } = await import('@lobehub/editor/headless');
  const browserSecret = process.env.DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET?.trim();
  const agentSecret =
    process.env.DOCUMENT_REWRITE_TICKET_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!browserSecret || !agentSecret) {
    throw new Error(
      'Page collaboration requires DOCUMENT_COLLABORATION_BROWSER_TICKET_SECRET and DOCUMENT_REWRITE_TICKET_SECRET (or AUTH_SECRET).',
    );
  }

  const { getServerDB } = await import('../../packages/database/src/core/db-adaptor');
  const db = await getServerDB();
  await db.execute(sql`SELECT 1`);
  const { createDocumentCollaborationPersistenceWorker } =
    await import('../../apps/server/src/services/documentCollaboration/worker');
  const { createCollaborationServer } = require('./server.cjs') as {
    createCollaborationServer: (options: Record<string, unknown>) => PageCollaborationServer;
  };
  const composition = createPageCollaborationComposition(db, {
    agentTicketService: new DocumentRewriteRoomTicketService({ secret: agentSecret }),
    browserTicketService: new BrowserTicketService({ secret: browserSecret }),
    persistenceWorker: createDocumentCollaborationPersistenceWorker(db),
  });
  const roomSnapshotLoader = createPageCollaborationRoomSnapshotLoader(db);
  const roomBackend = await createPageCollaborationRoomBackend({
    environment: process.env.NODE_ENV,
    redisUrl: process.env.REDIS_URL,
    redisPrefix: process.env.REDIS_PREFIX,
    snapshotLoader: roomSnapshotLoader,
  });
  const server = createCollaborationServer({
    allowLegacyProtocol: false,
    exposeRoomDiagnostics: false,
    migrateLegacyBlockImagesInYjsDoc,
    onRoomUpdate: composition.onRoomUpdate,
    roomBackend,
    ticketVerifier: composition.ticketVerifier,
  });
  const port = Number(process.env.PAGE_COLLABORATION_PORT || 12_345);
  const host = process.env.PAGE_COLLABORATION_HOST || '127.0.0.1';
  try {
    const address = await server.listen(port, host);
    console.info(`[page-collaboration] listening on http://${host}:${address.port}`);
    return server;
  } catch (error) {
    // The backend owns Redis connections and replay/lease state. A bind error
    // must tear the composition down instead of leaving a half-started worker.
    await server.close().catch(() => undefined);
    throw error;
  }
};

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  let server: PageCollaborationServer | undefined;
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    try {
      await server?.close();
      console.info(`[page-collaboration] closed after ${signal}`);
      process.exit(0);
    } catch (error) {
      console.error('[page-collaboration] shutdown failed', error);
      process.exit(1);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  startPageCollaborationServer()
    .then((started) => {
      server = started;
    })
    .catch((error) => {
      console.error('[page-collaboration] startup failed', error);
      process.exitCode = 1;
    });
}
