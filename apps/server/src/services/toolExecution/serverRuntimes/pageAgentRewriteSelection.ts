import type {
  RewriteSelectionArgs,
  RewriteSelectionState,
} from '@lobechat/builtin-tool-page-agent';
import type {
  PageAgentApiOutput,
  PageAgentInvocationContext,
} from '@lobechat/builtin-tool-page-agent/executionRuntime';

import { DocumentModel } from '@/database/models/document';
import { normalizeDocumentRewriteProgress } from '@/database/models/documentRewriteRequest';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import {
  DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
  DOCUMENT_REWRITE_REQUEST_INVALID,
  DOCUMENT_REWRITE_REQUEST_NOT_FOUND,
  DocumentRewriteRequestService,
} from '@/server/services/documentRewrite';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

export interface PageAgentRewriteSelectionServiceOptions {
  db: LobeChatDatabase;
  /** Injectable for unit tests and deployment composition. */
  requestService?: DocumentRewriteRequestService;
  userId: string;
  workspaceId?: string | null;
}

const MAX_REQUEST_ID_LENGTH = 255;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeArgs = (value: unknown): RewriteSelectionArgs => {
  if (!isRecord(value)) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: rewriteSelection arguments`);
  }
  if (Object.keys(value).some((key) => key !== 'requestId' && key !== 'instruction')) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: rewriteSelection arguments`);
  }

  const requestId = value.requestId;
  if (
    typeof requestId !== 'string' ||
    requestId.trim().length === 0 ||
    requestId.trim().length > MAX_REQUEST_ID_LENGTH
  ) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: requestId`);
  }

  const instruction = value.instruction;
  if (
    instruction !== undefined &&
    (typeof instruction !== 'string' ||
      instruction.trim().length === 0 ||
      instruction.trim().length > DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH)
  ) {
    throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: instruction`);
  }

  return {
    requestId: requestId.trim(),
    ...(instruction === undefined ? {} : { instruction: instruction.trim() }),
  };
};

const assertDocumentEditAccess = async (options: {
  db: LobeChatDatabase;
  documentId: string;
  userId: string;
  workspaceId?: string | null;
}): Promise<void> => {
  if (options.workspaceId) {
    await assertCanPerformResourceAction({
      action: 'edit',
      db: options.db,
      resourceId: options.documentId,
      resourceType: 'document',
      userId: options.userId,
      workspaceId: options.workspaceId,
    });
    return;
  }

  const document = await new DocumentModel(options.db, options.userId).findById(options.documentId);
  if (!document) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
};

const toState = (request: Awaited<ReturnType<DocumentRewriteRequestService['findById']>>) => {
  if (!request) return undefined;
  const updatedAt =
    request.updatedAt instanceof Date
      ? request.updatedAt.toISOString()
      : new Date(request.updatedAt).toISOString();
  const progress = normalizeDocumentRewriteProgress(request.progress);
  const state: RewriteSelectionState = {
    attempt: request.attempt,
    errorCode: request.errorCode,
    errorMessage: request.errorMessage,
    requestId: request.id,
    ...(request.parentRequestId ? { parentRequestId: request.parentRequestId } : {}),
    ...(progress ? { progress: progress as RewriteSelectionState['progress'] } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    status: request.status,
    ...(typeof request.turnIndex === 'number' ? { turnIndex: request.turnIndex } : {}),
    updatedAt,
  };
  return state;
};

const toOutput = (state: RewriteSelectionState): PageAgentApiOutput => {
  const errorSuffix = state.errorMessage ? ` Error: ${state.errorMessage}` : '';
  return {
    content: `Targeted rewrite request "${state.requestId}" is ${state.status} (attempt ${state.attempt}).${errorSuffix}`,
    state: { ...state },
  };
};

/**
 * Server-only Page Agent bridge for targeted collaborative rewrite.
 *
 * The adapter deliberately accepts no selection or editor data. It resolves
 * the request through the user/workspace-scoped request service, re-checks the
 * live document and agent ACL, and lets the service deliver only the durable
 * `{ requestId, attempt }` queue message.
 */
export const createPageAgentRewriteSelectionService = (
  options: PageAgentRewriteSelectionServiceOptions,
) => {
  const requestService =
    options.requestService ??
    new DocumentRewriteRequestService(options.db, options.userId, options.workspaceId);

  return async (
    rawArgs: RewriteSelectionArgs,
    ctx: PageAgentInvocationContext,
  ): Promise<PageAgentApiOutput> => {
    const args = normalizeArgs(rawArgs);
    if (!ctx.documentId) {
      throw new Error('documentId is required for rewriteSelection');
    }
    if (!ctx.agentId) {
      throw new Error('agentId is required for rewriteSelection');
    }
    if (ctx.userId && ctx.userId !== options.userId) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: userId mismatch`);
    }
    if (
      ctx.workspaceId !== undefined &&
      (ctx.workspaceId ?? null) !== (options.workspaceId ?? null)
    ) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: workspaceId mismatch`);
    }

    const request = await requestService.findById(args.requestId);
    if (!request) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
    if (request.documentId !== ctx.documentId) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: documentId mismatch`);
    }
    if (request.agentId !== ctx.agentId) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: agentId mismatch`);
    }
    if (request.requestedByUserId !== options.userId) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: userId mismatch`);
    }
    if ((request.workspaceId ?? null) !== (options.workspaceId ?? null)) {
      throw new Error(`${DOCUMENT_REWRITE_REQUEST_INVALID}: workspaceId mismatch`);
    }

    // The request service's row scope is a first guard. These checks are the
    // second guard at the tool execution boundary, so a request cannot remain
    // usable after document or agent visibility/ACL changes.
    await assertDocumentEditAccess({
      db: options.db,
      documentId: request.documentId,
      userId: options.userId,
      workspaceId: options.workspaceId,
    });
    await assertAgentUsableBy(options.db, request.agentId, {
      userId: options.userId,
      workspaceId: options.workspaceId ?? undefined,
    });

    const result = await requestService.enqueueExisting(
      args.requestId,
      args.instruction === undefined ? {} : { instruction: args.instruction },
    );
    const state = toState(result.request);
    if (!state) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
    return toOutput(state);
  };
};

export type PageAgentRewriteSelectionService = ReturnType<
  typeof createPageAgentRewriteSelectionService
>;
