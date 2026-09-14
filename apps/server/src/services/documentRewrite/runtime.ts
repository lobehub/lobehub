import { getServerDB } from '@/database/core/db-adaptor';
import { appEnv } from '@/envs/app';

import { createProductionRewriteGeneratorFactory } from './productionGenerator';
import {
  createLocalDocumentRewriteQueue,
  createQStashDocumentRewriteQueue,
  DOCUMENT_REWRITE_QUEUE_PATH,
  type DocumentRewriteQueue,
} from './queue';
import {
  configureDocumentRewriteQueue,
  createDatabaseDocumentRewriteTicketAuthorizer,
  createDocumentRewriteRoomTicketVerifier,
} from './service';
import {
  createDocumentRewriteWorker,
  type DocumentRewriteWorker,
  type DocumentRewriteWorkerFactory,
} from './worker';

export interface DocumentRewriteRuntime {
  createWorker: DocumentRewriteWorkerFactory;
  queue: DocumentRewriteQueue;
}

let runtime: DocumentRewriteRuntime | undefined;
let initializationPromise: Promise<DocumentRewriteRuntime> | undefined;
let recoveryPromise: Promise<void> | undefined;
let lastRecoveryAt = 0;

export const DOCUMENT_REWRITE_RECOVERY_COOLDOWN_MS = 30_000;

const resolveQueueEndpoint = (): string => {
  const baseUrl = (appEnv.INTERNAL_APP_URL || appEnv.APP_URL).replace(/\/$/, '');
  return `${baseUrl}${DOCUMENT_REWRITE_QUEUE_PATH}`;
};

/**
 * Compose the durable rewrite queue and worker once per server process.
 *
 * Local mode uses the same DB-backed worker behind a setTimeout adapter. Queue
 * mode publishes only `{requestId, attempt}` to QStash. In either mode, rows
 * remain the recovery authority if this process exits before delivery.
 */
export const initializeDocumentRewriteRuntime = async (): Promise<DocumentRewriteRuntime> => {
  if (runtime) return runtime;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    let queue: DocumentRewriteQueue;
    if (appEnv.enableQueueAgentRuntime) {
      // Keep QStash/QueueService out of cold module imports. It constructs a
      // provider client and validates deployment credentials only when the
      // queue runtime is actually selected.
      const { QueueService } = await import('@/server/services/queue');
      queue = createQStashDocumentRewriteQueue({
        endpoint: resolveQueueEndpoint(),
        queueService: new QueueService(),
      });
    } else {
      const localQueue = createLocalDocumentRewriteQueue({
        handler: async (message) => {
          const db = await getServerDB();
          await createDefaultWorker({ db, queue: localQueue }).process(message);
        },
        onError: (error, message) => {
          console.error(
            `Document rewrite local delivery failed request=${message.requestId} attempt=${message.attempt}:`,
            error,
          );
        },
      });
      queue = localQueue;
    }

    const createWorker: DocumentRewriteWorkerFactory = ({ db }) =>
      createDefaultWorker({ db, queue });
    const composed = { createWorker, queue };
    runtime = composed;
    configureDocumentRewriteQueue(queue);
    return composed;
  })();
  try {
    return await initializationPromise;
  } finally {
    initializationPromise = undefined;
  }
};

const createDefaultWorker = (options: {
  db: Awaited<ReturnType<typeof getServerDB>>;
  queue?: DocumentRewriteQueue;
}): DocumentRewriteWorker =>
  createDocumentRewriteWorker({
    db: options.db,
    generatorFactory: createProductionRewriteGeneratorFactory({ db: options.db }),
    queue: options.queue,
  });

export const getDocumentRewriteRuntime = (): Promise<DocumentRewriteRuntime> =>
  initializeDocumentRewriteRuntime();

export const getDocumentRewriteWorkerFactory = async (): Promise<DocumentRewriteWorkerFactory> =>
  (await initializeDocumentRewriteRuntime()).createWorker;

export const isDocumentRewriteRuntimeInitialized = (): boolean => Boolean(runtime);

export const getDocumentRewriteRuntimeStatus = () => ({
  configured: true,
  initialized: Boolean(runtime),
  mode: appEnv.enableQueueAgentRuntime ? ('qstash' as const) : ('local' as const),
});

/** Composition-root helper for the collaboration server's `ticketVerifier`. */
export const createDocumentRewriteRoomTicketVerifierForDatabase = (
  db: Awaited<ReturnType<typeof getServerDB>>,
) =>
  createDocumentRewriteRoomTicketVerifier({
    authorize: createDatabaseDocumentRewriteTicketAuthorizer(db),
  });

export const createDatabaseDocumentRewriteRoomTicketVerifier =
  createDocumentRewriteRoomTicketVerifierForDatabase;
export const createDatabaseDocumentRewriteTicketVerifier =
  createDocumentRewriteRoomTicketVerifierForDatabase;

/**
 * Start at most one bounded recovery scan for a process. This is intentionally
 * best-effort: a DB/queue outage must not break module import or the request
 * API, and the next process/cron invocation can retry the scan.
 */
export const recoverDocumentRewriteRuntime = async (
  db?: Awaited<ReturnType<typeof getServerDB>>,
  limit = 50,
  options: { force?: boolean; onError?: (error: unknown) => void } = {},
): Promise<void> => {
  await initializeDocumentRewriteRuntime();
  if (recoveryPromise) return recoveryPromise;
  const now = Date.now();
  if (
    !options.force &&
    lastRecoveryAt > 0 &&
    now - lastRecoveryAt < DOCUMENT_REWRITE_RECOVERY_COOLDOWN_MS
  ) {
    return;
  }
  lastRecoveryAt = now;
  recoveryPromise = (async () => {
    try {
      const database = db ?? (await getServerDB());
      await createDefaultWorker({
        db: database,
        queue: runtime?.queue,
      }).recoverRunnable(limit);
    } catch (error) {
      options.onError?.(error);
      console.error('Document rewrite recovery scan failed:', error);
    }
  })().finally(() => {
    recoveryPromise = undefined;
  });
  return recoveryPromise;
};

export const resetDocumentRewriteRuntimeForTests = (): void => {
  if (runtime?.queue && 'close' in runtime.queue && typeof runtime.queue.close === 'function') {
    runtime.queue.close();
  }
  runtime = undefined;
  initializationPromise = undefined;
  recoveryPromise = undefined;
  lastRecoveryAt = 0;
  configureDocumentRewriteQueue(undefined);
};
