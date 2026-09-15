import type { QueueMessage } from '@/server/services/queue/types';

/**
 * The only application payload carried by a rewrite delivery.  The request
 * row is the source of truth; instructions, selection anchors, room tickets,
 * provider credentials, and model output must never be copied into a queue
 * message.
 */
export interface DocumentRewriteQueueMessage {
  attempt: number;
  requestId: string;
}

export interface DocumentRewriteQueueEnqueueOptions {
  delayMs?: number;
}

export interface DocumentRewriteQueue {
  enqueue: (
    message: DocumentRewriteQueueMessage,
    options?: DocumentRewriteQueueEnqueueOptions,
  ) => Promise<string>;
}

export const DOCUMENT_REWRITE_QUEUE_PATH = '/api/agent/document-rewrite';
export const DOCUMENT_REWRITE_QUEUE_MESSAGE_MAX_REQUEST_ID = 255;
export const DOCUMENT_REWRITE_QUEUE_MESSAGE_MAX_DELAY_MS = 24 * 60 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRequestId = (value: unknown): string | undefined => {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > DOCUMENT_REWRITE_QUEUE_MESSAGE_MAX_REQUEST_ID
  ) {
    return undefined;
  }
  return value.trim();
};

const normalizeAttempt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** Parse untrusted queue/webhook input without coercing malformed fields. */
export const parseDocumentRewriteQueueMessage = (
  value: unknown,
): DocumentRewriteQueueMessage | null => {
  if (!isRecord(value)) return null;
  const requestId = normalizeRequestId(value.requestId);
  const attempt = normalizeAttempt(value.attempt);
  if (!requestId || attempt === undefined) return null;

  // A queue message is deliberately tiny. Rejecting unknown keys prevents a
  // future caller from accidentally smuggling a ticket, snapshot, or prompt
  // into the durable delivery contract.
  if (Object.keys(value).some((key) => key !== 'requestId' && key !== 'attempt')) return null;
  return { attempt, requestId };
};

export const createDocumentRewriteQueueMessage = (
  requestId: string,
  attempt: number,
): DocumentRewriteQueueMessage => {
  const message = parseDocumentRewriteQueueMessage({ requestId, attempt });
  if (!message) throw new Error('Invalid document rewrite queue message');
  return message;
};

const normalizeDelay = (delayMs: number | undefined): number => {
  const delay = delayMs ?? 0;
  if (!Number.isFinite(delay) || !Number.isInteger(delay) || delay < 0) {
    throw new Error('Invalid document rewrite queue delay');
  }
  return Math.min(delay, DOCUMENT_REWRITE_QUEUE_MESSAGE_MAX_DELAY_MS);
};

export interface LocalDocumentRewriteQueueOptions {
  defaultDelayMs?: number;
  handler?: (message: DocumentRewriteQueueMessage) => Promise<unknown> | unknown;
  onError?: (error: unknown, message: DocumentRewriteQueueMessage) => void;
}

/**
 * In-process adapter used by local development and deterministic tests.
 * Pending work is still represented by the database row; `recoverRunnable`
 * on the worker repopulates this adapter after a process restart.
 */
export class LocalDocumentRewriteQueue implements DocumentRewriteQueue {
  private readonly defaultDelayMs: number;
  private readonly handler?: LocalDocumentRewriteQueueOptions['handler'];
  private readonly onError?: LocalDocumentRewriteQueueOptions['onError'];
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: LocalDocumentRewriteQueueOptions = {}) {
    this.defaultDelayMs = normalizeDelay(options.defaultDelayMs);
    this.handler = options.handler;
    this.onError = options.onError;
  }

  private key = (message: DocumentRewriteQueueMessage): string =>
    `${message.requestId}:${message.attempt}`;

  enqueue = async (
    input: DocumentRewriteQueueMessage,
    options: DocumentRewriteQueueEnqueueOptions = {},
  ): Promise<string> => {
    const message = createDocumentRewriteQueueMessage(input.requestId, input.attempt);
    const delayMs = normalizeDelay(options.delayMs ?? this.defaultDelayMs);
    const key = this.key(message);
    const existing = this.pending.get(key);
    if (existing) return `local-document-rewrite-${key}`;

    // The request/attempt pair is the idempotency key, so a duplicate pending
    // delivery should return the same task id instead of creating a second
    // timer. A later delivery after completion may reuse this deterministic id
    // and will still be guarded by the durable request claim.
    const taskId = `local-document-rewrite-${key}`;
    const timer = setTimeout(() => {
      this.pending.delete(key);
      if (!this.handler) return;
      Promise.resolve()
        .then(() => this.handler?.(message))
        .catch((error: unknown) => {
          this.onError?.(error, message);
        });
    }, delayMs);
    // Timers should not keep a development process alive during shutdown.
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.pending.set(key, timer);
    return taskId;
  };

  /** Cancel only an undelivered local timer; DB cancellation remains authoritative. */
  cancel = async (requestId: string, attempt: number): Promise<boolean> => {
    const message = createDocumentRewriteQueueMessage(requestId, attempt);
    const key = this.key(message);
    const timer = this.pending.get(key);
    if (!timer) return false;
    clearTimeout(timer);
    this.pending.delete(key);
    return true;
  };

  getPendingCount = (): number => this.pending.size;

  close = (): void => {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  };
}

export interface QueueServiceDocumentRewriteQueueOptions {
  endpoint: string;
  queueService: {
    scheduleMessage: (message: QueueMessage) => Promise<string>;
  };
  retries?: number;
  retryDelay?: string;
}

/**
 * Adapter over the existing QueueService/QStash abstraction. QStash adds its
 * transport envelope, but `payload` contains exactly requestId + attempt.
 */
export class QueueServiceDocumentRewriteQueue implements DocumentRewriteQueue {
  private readonly endpoint: string;
  private readonly queueService: QueueServiceDocumentRewriteQueueOptions['queueService'];
  private readonly retries: number;
  private readonly retryDelay?: string;

  constructor(options: QueueServiceDocumentRewriteQueueOptions) {
    if (typeof options.endpoint !== 'string' || options.endpoint.trim().length === 0) {
      throw new Error('Document rewrite queue endpoint is required');
    }
    let endpoint: URL;
    try {
      endpoint = new URL(options.endpoint);
    } catch {
      throw new Error('Document rewrite queue endpoint must be an absolute URL');
    }
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      throw new Error('Document rewrite queue endpoint must use http or https');
    }
    this.endpoint = endpoint.toString();
    this.queueService = options.queueService;
    this.retries = Math.max(0, Math.min(Math.trunc(options.retries ?? 3), 10));
    this.retryDelay = options.retryDelay;
  }

  enqueue = async (
    input: DocumentRewriteQueueMessage,
    options: DocumentRewriteQueueEnqueueOptions = {},
  ): Promise<string> => {
    const message = createDocumentRewriteQueueMessage(input.requestId, input.attempt);
    const delayMs = normalizeDelay(options.delayMs);
    return this.queueService.scheduleMessage({
      delay: delayMs,
      endpoint: this.endpoint,
      operationId: `document-rewrite:${message.requestId}`,
      payload: message,
      priority: 'normal',
      retries: this.retries,
      retryDelay: this.retryDelay,
      stepIndex: message.attempt,
    });
  };
}

export type DocumentRewriteQueueService = QueueServiceDocumentRewriteQueue;
export const LocalDocumentRewriteQueueService = LocalDocumentRewriteQueue;
export const DocumentRewriteLocalQueueAdapter = LocalDocumentRewriteQueue;
export const DocumentRewriteQStashQueueAdapter = QueueServiceDocumentRewriteQueue;

export const createLocalDocumentRewriteQueue = (
  options: LocalDocumentRewriteQueueOptions = {},
): LocalDocumentRewriteQueue => new LocalDocumentRewriteQueue(options);

export const createQueueServiceDocumentRewriteQueue = (
  options: QueueServiceDocumentRewriteQueueOptions,
): QueueServiceDocumentRewriteQueue => new QueueServiceDocumentRewriteQueue(options);

export const createQStashDocumentRewriteQueue = createQueueServiceDocumentRewriteQueue;
