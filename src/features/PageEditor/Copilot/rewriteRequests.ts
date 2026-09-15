'use client';

import type {
  RewriteProgress as PublicRewriteProgress,
  RewriteProgressEvent as PublicRewriteProgressEvent,
  RewriteProgressStage as PublicRewriteProgressStage,
} from '@lobechat/builtin-tool-page-agent';
import type { CapturedCollaborativeRewriteSelection } from '@lobehub/editor';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

export const PAGE_REWRITE_STATUSES = [
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'awaiting_review',
  'applied',
  'rejected',
  'cancel_requested',
  'canceled',
  'canceled_after_write',
  'retry_wait',
  'stale',
  'failed',
] as const;

export type PageRewriteStatus = (typeof PAGE_REWRITE_STATUSES)[number];

export const PAGE_REWRITE_MAX_ACTIVE_REQUESTS = 5;

const PAGE_REWRITE_ACTIVE_STATUSES = new Set<PageRewriteStatus>([
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'cancel_requested',
  'retry_wait',
]);

export const isPageRewriteActiveStatus = (status: PageRewriteStatus): boolean =>
  PAGE_REWRITE_ACTIVE_STATUSES.has(status);

export interface PageRewriteRequest {
  agentId: string;
  attempt: number;
  createdAt: string;
  documentId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: string | null;
  generationId?: string | null;
  id: string;
  instruction: string;
  lastCommandId?: string | null;
  model?: string | null;
  outputText?: string | null;
  parentRequestId?: string | null;
  progress?: PageRewriteProgress | null;
  provider?: string | null;
  requestedModel?: string | null;
  requestedProvider?: string | null;
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown>;
  sessionId?: string | null;
  status: PageRewriteStatus;
  topicId?: string | null;
  turnIndex?: number;
  updatedAt: string;
}

export type PageRewriteProgressStage = PublicRewriteProgressStage;
export type PageRewriteProgressEvent = PublicRewriteProgressEvent;
export type PageRewriteProgress = PublicRewriteProgress;

const PAGE_REWRITE_PROGRESS_STAGES = new Set<PageRewriteProgressStage>([
  'analyzing_context',
  'applying',
  'generating_replacement',
  'reading_block',
  'reading_search',
  'reading_structure',
  'syncing',
]);
const PAGE_REWRITE_PROGRESS_TOOLS = new Set([
  'read_document_structure',
  'read_document_block',
  'read_document_range',
  'search_document_text',
]);
const PAGE_REWRITE_PROGRESS_MAX_EVENTS = 32;
const PAGE_REWRITE_PROGRESS_TEXT_MAX_LENGTH = 512;

const clipProgressText = (value: string, maxLength: number): string =>
  Array.from(value).slice(0, maxLength).join('');

const normalizeProgressTimestamp = (value: unknown): string => {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};

/** Keep API progress display-only and discard unknown/raw provider fields. */
export const normalizePageRewriteProgress = (value: unknown): PageRewriteProgress | null => {
  if (!isRecord(value)) return null;
  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const events: PageRewriteProgressEvent[] = [];
  for (const rawEvent of rawEvents.slice(-PAGE_REWRITE_PROGRESS_MAX_EVENTS)) {
    if (!isRecord(rawEvent) || !PAGE_REWRITE_PROGRESS_STAGES.has(rawEvent.stage as never)) continue;
    const detail =
      typeof rawEvent.detail === 'string'
        ? clipProgressText(rawEvent.detail, PAGE_REWRITE_PROGRESS_TEXT_MAX_LENGTH)
        : undefined;
    const summary =
      typeof rawEvent.summary === 'string'
        ? clipProgressText(rawEvent.summary, PAGE_REWRITE_PROGRESS_TEXT_MAX_LENGTH)
        : undefined;
    const tool =
      typeof rawEvent.tool === 'string' && PAGE_REWRITE_PROGRESS_TOOLS.has(rawEvent.tool)
        ? rawEvent.tool
        : undefined;
    events.push({
      at: normalizeProgressTimestamp(rawEvent.at),
      ...(detail ? { detail } : {}),
      stage: rawEvent.stage as PageRewriteProgressStage,
      ...(summary ? { summary } : {}),
      ...(tool ? { tool } : {}),
    });
  }
  const currentStage = PAGE_REWRITE_PROGRESS_STAGES.has(value.currentStage as never)
    ? (value.currentStage as PageRewriteProgressStage)
    : events.at(-1)?.stage;
  if (!currentStage) return null;
  const summary =
    typeof value.summary === 'string'
      ? clipProgressText(value.summary, PAGE_REWRITE_PROGRESS_TEXT_MAX_LENGTH)
      : undefined;
  return {
    currentStage,
    events,
    ...(summary ? { summary } : {}),
    updatedAt: normalizeProgressTimestamp(value.updatedAt),
  };
};

export interface PageRewriteSessionGroup {
  /** Stable identity for a session, or the request id for legacy rows. */
  key: string;
  requests: PageRewriteRequest[];
  sessionId: string | null;
}

export const getActivePageRewriteRequestIds = (
  requests: readonly Pick<PageRewriteRequest, 'id' | 'status'>[],
): string[] => {
  const ids = new Set<string>();
  for (const request of requests) {
    if (isPageRewriteActiveStatus(request.status)) ids.add(request.id);
  }
  return [...ids];
};

const PAGE_REWRITE_ATTENTION_STATUSES = new Set<PageRewriteStatus>(['failed', 'stale']);

const comparePageRewriteRequests = (
  left: PageRewriteRequest,
  right: PageRewriteRequest,
): number => {
  const turnDifference = (right.turnIndex ?? 1) - (left.turnIndex ?? 1);
  if (turnDifference !== 0) return turnDifference;

  const updatedDifference = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedDifference !== 0) return updatedDifference;

  const createdDifference = right.createdAt.localeCompare(left.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return right.id.localeCompare(left.id);
};

const getPageRewriteSessionPriority = (group: PageRewriteSessionGroup): number => {
  const latest = group.requests[0];
  if (!latest) return 3;
  if (isPageRewriteActiveStatus(latest.status)) return 0;
  if (PAGE_REWRITE_ATTENTION_STATUSES.has(latest.status)) return 1;
  return 2;
};

/** Compare the newest request in two already-grouped sessions. Turn order is
 * meaningful only inside one session; across sessions the latest durable
 * timestamp is the display recency signal. */
const comparePageRewriteSessionGroups = (
  left: PageRewriteSessionGroup,
  right: PageRewriteSessionGroup,
): number => {
  const priorityDifference =
    getPageRewriteSessionPriority(left) - getPageRewriteSessionPriority(right);
  if (priorityDifference !== 0) return priorityDifference;

  const leftLatest = left.requests[0];
  const rightLatest = right.requests[0];
  if (!leftLatest || !rightLatest) return 0;

  const updatedDifference = rightLatest.updatedAt.localeCompare(leftLatest.updatedAt);
  if (updatedDifference !== 0) return updatedDifference;

  const createdDifference = rightLatest.createdAt.localeCompare(leftLatest.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return rightLatest.id.localeCompare(leftLatest.id);
};

/**
 * Collapse all rewrite rounds into one display group per durable session.
 * Requests without a session id are deliberately kept as one-request legacy
 * groups so older server rows cannot accidentally merge with one another.
 */
export const groupPageRewriteRequests = (
  requests: readonly PageRewriteRequest[],
): PageRewriteSessionGroup[] => {
  const groups = new Map<string, PageRewriteSessionGroup>();

  for (const request of requests) {
    const key = request.sessionId || request.id;
    const existing = groups.get(key);
    if (existing) {
      existing.requests.push(request);
      continue;
    }

    groups.set(key, {
      key,
      requests: [request],
      sessionId: request.sessionId || null,
    });
  }

  const grouped = [...groups.values()];
  for (const group of grouped) group.requests.sort(comparePageRewriteRequests);

  return grouped.sort(comparePageRewriteSessionGroups);
};

type RewriteRequestInput = {
  agentId: string;
  documentId: string;
  expiresAt?: Date;
  id?: string;
  instruction: string;
  model?: string | null;
  operationId?: string | null;
  provider?: string | null;
  selection: CapturedCollaborativeRewriteSelection | Record<string, unknown>;
  toolCallId?: string | null;
  topicId?: string | null;
};

type RewriteRequestClient = {
  cancel: (input: { attempt?: number; id: string }) => Promise<unknown>;
  continue: (input: {
    instruction: string;
    model?: string | null;
    parentRequestId: string;
    provider?: string | null;
  }) => Promise<unknown>;
  create: (input: RewriteRequestInput) => Promise<unknown>;
  deleteSession: (input: {
    documentId: string;
    requestId?: string;
    sessionId?: string;
  }) => Promise<unknown>;
  list: (input: { documentId: string; limit?: number }) => Promise<unknown>;
  review: (input: {
    attempt: number;
    expectedCommandId?: string;
    id: string;
    stateVector: string;
    status: 'applied' | 'rejected';
  }) => Promise<unknown>;
  retry: (input: { attempt: number; delayMs?: number; id: string }) => Promise<unknown>;
};

export interface PageRewriteReviewSettlement {
  attempt: number;
  expectedCommandId: string;
  id: string;
  stateVector: string;
  status: 'applied' | 'rejected';
}

export interface PageRewriteReviewFailure extends PageRewriteReviewSettlement {
  errorMessage: string;
}

/**
 * Small Page adapter around the server router. Keep backend row details out of
 * components so request schema changes stay isolated to this file.
 */
export const pageRewriteRequestClient: RewriteRequestClient = {
  cancel: (input) =>
    lambdaClient.documentRewrite.cancel.mutate(
      input as Parameters<typeof lambdaClient.documentRewrite.cancel.mutate>[0],
    ),
  create: (input) =>
    lambdaClient.documentRewrite.create.mutate(
      input as Parameters<typeof lambdaClient.documentRewrite.create.mutate>[0],
    ),
  continue: (input) =>
    lambdaClient.documentRewrite.continue.mutate(
      input as Parameters<typeof lambdaClient.documentRewrite.continue.mutate>[0],
    ),
  deleteSession: (input) =>
    lambdaClient.documentRewrite.deleteSession.mutate(
      input as Parameters<typeof lambdaClient.documentRewrite.deleteSession.mutate>[0],
    ),
  list: (input) =>
    lambdaClient.documentRewrite.list.query(
      input as Parameters<typeof lambdaClient.documentRewrite.list.query>[0],
    ),
  review: (input) =>
    lambdaClient.documentRewrite.review.mutate(
      input as Parameters<typeof lambdaClient.documentRewrite.review.mutate>[0],
    ),
  retry: (input) =>
    lambdaClient.documentRewrite.retry.mutate(
      input as Parameters<typeof lambdaClient.documentRewrite.retry.mutate>[0],
    ),
};

const reviewFailures = new Map<string, PageRewriteReviewFailure>();
const reviewFailureListeners = new Set<() => void>();
const inFlightReviewSettlements = new Map<string, Promise<unknown>>();
const MAX_REVIEW_FAILURES = 1000;

const emitReviewFailureChange = (): void => {
  reviewFailureListeners.forEach((listener) => listener());
};

export const subscribePageRewriteReviewFailures = (listener: () => void): (() => void) => {
  reviewFailureListeners.add(listener);
  return () => reviewFailureListeners.delete(listener);
};

export const getPageRewriteReviewFailure = (requestId: string): PageRewriteReviewFailure | null =>
  reviewFailures.get(requestId) ?? null;

export const recordPageRewriteReviewFailure = (
  settlement: PageRewriteReviewSettlement,
  error: unknown,
): PageRewriteReviewFailure => {
  const failure: PageRewriteReviewFailure = {
    ...settlement,
    errorMessage: getPageRewriteErrorMessage(error, 'Unable to settle this review'),
  };
  reviewFailures.set(settlement.id, failure);
  while (reviewFailures.size > MAX_REVIEW_FAILURES) {
    const oldest = reviewFailures.keys().next().value;
    if (oldest === undefined) break;
    reviewFailures.delete(oldest);
  }
  emitReviewFailureChange();
  return failure;
};

export const clearPageRewriteReviewFailure = (requestId: string): void => {
  if (!reviewFailures.delete(requestId)) return;
  emitReviewFailureChange();
};

interface SettlePageRewriteReviewOptions {
  baseDelayMs?: number;
  maxAttempts?: number;
  review?: RewriteRequestClient['review'];
  sleep?: (delayMs: number) => Promise<void>;
}

const waitForReviewRetry = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

/**
 * Settle a review with bounded, idempotent retries. The command id remains an
 * expected value on every attempt, so a late duplicate cannot settle another
 * generation. A final failure is retained for the Page panel to expose.
 */
export const settlePageRewriteReview = (
  settlement: PageRewriteReviewSettlement,
  options: SettlePageRewriteReviewOptions = {},
): Promise<unknown> => {
  // Toolbar and Pending Agent Edits can settle the same Diff in the same tick.
  // Coalesce those calls by durable identity so one local action does not
  // create duplicate review requests (the server remains idempotent too).
  const key = [
    settlement.id,
    settlement.attempt,
    settlement.expectedCommandId,
    settlement.status,
  ].join('\u0000');
  const existing = inFlightReviewSettlements.get(key);
  if (existing) return existing;

  const operation = (async () => {
    const maxAttempts = Math.min(Math.max(Math.trunc(options.maxAttempts ?? 3), 1), 4);
    const baseDelayMs = Math.min(Math.max(Math.trunc(options.baseDelayMs ?? 250), 1), 2_000);
    const review = options.review ?? pageRewriteRequestClient.review;
    const sleep = options.sleep ?? waitForReviewRetry;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await review({ ...settlement });
        clearPageRewriteReviewFailure(settlement.id);
        return result;
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) break;
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }

    recordPageRewriteReviewFailure(settlement, lastError);
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })();
  inFlightReviewSettlements.set(key, operation);
  void operation.then(
    () => {
      if (inFlightReviewSettlements.get(key) === operation) inFlightReviewSettlements.delete(key);
    },
    () => {
      if (inFlightReviewSettlements.get(key) === operation) inFlightReviewSettlements.delete(key);
    },
  );
  return operation;
};

export const retryPageRewriteReview = async (requestId: string): Promise<unknown> => {
  const failure = getPageRewriteReviewFailure(requestId);
  if (!failure) return undefined;
  return settlePageRewriteReview(failure);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toISOString = (value: unknown, fallback = new Date()): string => {
  const date =
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
};

const isPageRewriteStatus = (value: unknown): value is PageRewriteStatus =>
  typeof value === 'string' && (PAGE_REWRITE_STATUSES as readonly string[]).includes(value);

const normalizeSelection = (
  value: unknown,
): CapturedCollaborativeRewriteSelection | Record<string, unknown> =>
  isRecord(value) ? value : {};

export const toPageRewriteRequest = (value: unknown): PageRewriteRequest | null => {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.documentId !== 'string' || value.documentId.length === 0) return null;
  if (typeof value.agentId !== 'string' || value.agentId.length === 0) return null;
  if (!isPageRewriteStatus(value.status)) return null;

  return {
    agentId: value.agentId,
    attempt: typeof value.attempt === 'number' ? value.attempt : 1,
    createdAt: toISOString(value.createdAt),
    documentId: value.documentId,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : null,
    errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : null,
    expiresAt: value.expiresAt ? toISOString(value.expiresAt) : null,
    generationId: typeof value.generationId === 'string' ? value.generationId : null,
    id: value.id,
    instruction: typeof value.instruction === 'string' ? value.instruction : '',
    lastCommandId: typeof value.lastCommandId === 'string' ? value.lastCommandId : null,
    model: typeof value.model === 'string' ? value.model : null,
    outputText: typeof value.outputText === 'string' ? value.outputText : null,
    parentRequestId: typeof value.parentRequestId === 'string' ? value.parentRequestId : null,
    provider: typeof value.provider === 'string' ? value.provider : null,
    requestedModel: typeof value.requestedModel === 'string' ? value.requestedModel : null,
    requestedProvider: typeof value.requestedProvider === 'string' ? value.requestedProvider : null,
    progress: normalizePageRewriteProgress(value.progress),
    selection: normalizeSelection(value.selection),
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    status: value.status,
    topicId: typeof value.topicId === 'string' ? value.topicId : null,
    turnIndex: typeof value.turnIndex === 'number' ? value.turnIndex : 1,
    updatedAt: toISOString(
      value.updatedAt,
      value.createdAt ? new Date(value.createdAt as string) : new Date(),
    ),
  };
};

export const getRewriteQuotedText = (request: PageRewriteRequest): string => {
  const selection = request.selection;
  return isRecord(selection) && typeof selection.quotedText === 'string'
    ? selection.quotedText
    : '';
};

/** Avoid surfacing server transition constants as user-facing copy. */
export const getPageRewriteErrorMessage = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return !message || /^[A-Z][A-Z\d_]*(?::|$)/.test(message) || message.startsWith('Invalid ')
    ? fallback
    : message;
};

const getPageRewriteRawErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export const isPageRewriteActiveLimitError = (error: unknown): boolean =>
  getPageRewriteRawErrorMessage(error).includes('DOCUMENT_REWRITE_ACTIVE_LIMIT');

export const isPageRewriteTargetConflictError = (error: unknown): boolean =>
  /DOCUMENT_REWRITE_REQUEST_CONFLICT.*target already active/i.test(
    getPageRewriteRawErrorMessage(error),
  );

/** Stable server conflict codes used to localize continuation failures. */
export const isPageRewriteContinuationDeletedError = (error: unknown): boolean =>
  getPageRewriteRawErrorMessage(error).includes('DOCUMENT_REWRITE_CONTINUATION_DELETED');

export const isPageRewriteContinuationChangedError = (error: unknown): boolean =>
  getPageRewriteRawErrorMessage(error).includes('DOCUMENT_REWRITE_CONTINUATION_CHANGED');

const unwrapList = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.requests)) return value.requests;
  return [];
};

const loadRequests = async (documentId: string): Promise<PageRewriteRequest[]> => {
  const response = await pageRewriteRequestClient.list({ documentId, limit: 100 });
  return unwrapList(response)
    .map(toPageRewriteRequest)
    .filter((request): request is PageRewriteRequest => Boolean(request));
};

export const usePageRewriteRequests = (documentId?: string) => {
  const [pollingPaused, setPollingPaused] = useState(false);
  const swr = useSWR<PageRewriteRequest[]>(
    documentId ? ['page-rewrite-requests', documentId] : null,
    () => loadRequests(documentId!),
    {
      dedupingInterval: 1_000,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      refreshInterval: () => (pollingPaused ? 0 : 2_000),
      revalidateOnFocus: true,
      shouldRetryOnError: false,
      onError: () => setPollingPaused(true),
      onSuccess: () => setPollingPaused(false),
    },
  );
  const refresh = useCallback(() => {
    setPollingPaused(false);
    return swr.mutate();
  }, [swr.mutate]);

  return {
    error: swr.error as Error | undefined,
    isLoading: swr.isLoading && !swr.data,
    isValidating: swr.isValidating,
    mutate: refresh,
    requests: swr.data ?? [],
  };
};
