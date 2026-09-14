import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  createDocumentRewriteQueueMessage,
  DocumentRewriteWorker,
  type DocumentRewriteWorkerOptions,
  parseDocumentRewriteQueueMessage,
} from '@/server/services/documentRewrite';
import {
  getDocumentRewriteRuntimeStatus,
  getDocumentRewriteWorkerFactory,
  recoverDocumentRewriteRuntime,
} from '@/server/services/documentRewrite/runtime';

/**
 * Resolve the worker in the application composition root. Keeping this
 * injectable is intentional: model/provider credentials belong to deployment
 * wiring, not to the queue payload or the HTTP handler.
 */
export type DocumentRewriteWorkerFactory = (input: {
  db: Awaited<ReturnType<typeof getServerDB>>;
}) => DocumentRewriteWorker | Promise<DocumentRewriteWorker>;

/** Bind generator/editor/queue dependencies once in the deployment root. */
export const createDocumentRewriteWorkerFactory =
  (
    options: Omit<DocumentRewriteWorkerOptions, 'db' | 'requestService' | 'requestServiceFactory'>,
  ): DocumentRewriteWorkerFactory =>
  ({ db }) =>
    new DocumentRewriteWorker({ ...options, db });

let workerFactory: DocumentRewriteWorkerFactory | undefined;

export const configureDocumentRewriteWorker = (factory: DocumentRewriteWorkerFactory): void => {
  workerFactory = factory;
};

export const clearDocumentRewriteWorkerConfiguration = (): void => {
  workerFactory = undefined;
};

const extractMessage = (body: unknown) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const direct = parseDocumentRewriteQueueMessage(record);
  if (direct) return direct;
  // Existing QueueService/QStash envelopes put application fields under
  // payload. The envelope may contain operationId/stepIndex, but those are
  // transport metadata and never enter the worker contract.
  return parseDocumentRewriteQueueMessage(record.payload);
};

/** QStash/local queue delivery endpoint for one durable rewrite attempt. */
export async function documentRewrite(c: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const message = extractMessage(body);
  if (!message) return c.json({ error: 'requestId and positive attempt are required' }, 400);

  try {
    const db = await getServerDB();
    if (typeof (db as { select?: unknown }).select === 'function') {
      void recoverDocumentRewriteRuntime(db);
    }
    const workerFactoryForDelivery = workerFactory ?? (await getDocumentRewriteWorkerFactory());
    const worker = await workerFactoryForDelivery({ db });
    const result = await worker.process(
      createDocumentRewriteQueueMessage(message.requestId, message.attempt),
    );
    return c.json({ ...result, success: true });
  } catch (error) {
    // Non-2xx is deliberate: QStash/local deployers can redeliver while the
    // request row remains runnable. The worker itself records durable terminal
    // failures for model/command errors it can classify.
    return c.json(
      { error: error instanceof Error ? error.message : 'Document rewrite delivery failed' },
      500,
    );
  }
}

/** Explicit name for queue integrations that import handlers without routing. */
export const documentRewriteQueueHandler = documentRewrite;

export const documentRewriteHealth = (c: Context): Response =>
  c.json({
    ...getDocumentRewriteRuntimeStatus(),
    healthy: true,
    message: 'Document rewrite worker endpoint is running',
    timestamp: new Date().toISOString(),
  });

export const documentRewriteQueueHealth = documentRewriteHealth;
