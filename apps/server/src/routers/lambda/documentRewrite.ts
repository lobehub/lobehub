import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DocumentModel } from '@/database/models/document';
import type { DocumentRewriteRequestStatus } from '@/database/schemas/documentRewriteRequest';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  DOCUMENT_REWRITE_ACTIVE_LIMIT,
  DOCUMENT_REWRITE_CONTINUATION_CHANGED,
  DOCUMENT_REWRITE_CONTINUATION_DELETED,
  DOCUMENT_REWRITE_DISABLED,
  DOCUMENT_REWRITE_ERROR_MAX_LENGTH,
  DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
  DOCUMENT_REWRITE_QUOTED_TEXT_MAX_LENGTH,
  DOCUMENT_REWRITE_REQUEST_CONFLICT,
  DOCUMENT_REWRITE_REQUEST_EXPIRED,
  DOCUMENT_REWRITE_REQUEST_INVALID,
  DOCUMENT_REWRITE_REQUEST_NOT_FOUND,
  DOCUMENT_REWRITE_REVIEW_PROOF_INVALID,
  DocumentRewriteRequestService,
} from '@/server/services/documentRewrite';
import {
  initializeDocumentRewriteRuntime,
  recoverDocumentRewriteRuntime,
} from '@/server/services/documentRewrite/runtime';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

const idSchema = z.string().trim().min(1).max(255);
const dateSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));
const selectionSchema = z.record(z.string(), z.unknown()).superRefine((selection, ctx) => {
  if (selection.targetKind !== 'node') return;
  if (typeof selection.roomId !== 'string' || selection.roomId.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'selection.roomId is required for node targets',
      path: ['roomId'],
    });
  }
});
const statusSchema = z.enum([
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
]);

const createSchema = z.object({
  agentId: idSchema,
  documentId: idSchema,
  expiresAt: dateSchema,
  /** Idempotency key. It is not accepted as a provider/client secret. */
  id: idSchema.optional(),
  instruction: z.string().trim().min(1).max(DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH),
  /** Per-turn selection; it is persisted as an audit snapshot and does not mutate the Agent. */
  model: idSchema.nullish(),
  operationId: idSchema.nullish(),
  provider: idSchema.nullish(),
  selection: selectionSchema,
  toolCallId: idSchema.nullish(),
  topicId: idSchema.nullish(),
});

const listSchema = z.object({
  documentId: idSchema,
  limit: z.number().int().min(1).max(200).optional(),
  statuses: z.array(statusSchema).max(10).optional(),
});

const deleteSessionSchema = z
  .object({
    documentId: idSchema,
    requestId: idSchema.optional(),
    sessionId: idSchema.optional(),
  })
  .refine((input) => Boolean(input.requestId) !== Boolean(input.sessionId), {
    message: 'Exactly one of requestId or sessionId is required',
  });

const requestIdSchema = z.object({ id: idSchema });
const requestDocumentIdSchema = requestIdSchema.extend({ documentId: idSchema });
const continuationSchema = z.object({
  instruction: z.string().trim().min(1).max(DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH),
  model: idSchema.nullish(),
  parentRequestId: idSchema,
  provider: idSchema.nullish(),
});
const attemptSchema = z.number().int().min(1);

const cancelSchema = requestIdSchema.extend({ attempt: attemptSchema.optional() });
const retrySchema = requestIdSchema.extend({
  attempt: attemptSchema,
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60_000)
    .optional(),
});

const reviewSchema = requestIdSchema
  .extend({
    attempt: attemptSchema,
    /** New name makes the compare-only semantics explicit. */
    expectedCommandId: idSchema.nullish(),
    /** Compatibility alias for early clients; it is never written by review. */
    commandId: idSchema.nullish(),
    /** State vector observed after the Yjs Diff was accepted/rejected. */
    stateVector: z.string().trim().min(1).max(16_384),
    status: z.enum(['applied', 'rejected']),
  })
  .refine(
    (input) =>
      input.expectedCommandId === undefined ||
      input.commandId === undefined ||
      input.expectedCommandId === input.commandId,
    { message: 'expectedCommandId and commandId must match' },
  );

export type DocumentRewriteRouterContext = {
  documentRewriteService: DocumentRewriteRequestService;
  serverDB: Parameters<typeof assertCanPerformResourceAction>[0]['db'];
  userId: string;
  workspaceId?: string | null;
};

const documentRewriteProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  // Lazy composition avoids creating queue clients/timers during a cold module
  // import, while the request's DB handle is available for one bounded recovery
  // scan before the service can enqueue a newly committed row.
  await initializeDocumentRewriteRuntime();
  if (typeof (ctx.serverDB as { select?: unknown }).select === 'function') {
    void recoverDocumentRewriteRuntime(ctx.serverDB);
  }
  return opts.next({
    ctx: {
      documentRewriteService: new DocumentRewriteRequestService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

/**
 * All request operations re-check the document resource. The request model's
 * workspace/owner scope is defense in depth, not a replacement for resource
 * ACL: a workspace member may see only documents they can view/edit.
 */
const assertDocumentAccess = async (
  ctx: Pick<DocumentRewriteRouterContext, 'serverDB' | 'userId' | 'workspaceId'>,
  documentId: string,
  action: 'edit' | 'view',
) => {
  if (ctx.workspaceId) {
    await assertCanPerformResourceAction({
      action,
      db: ctx.serverDB,
      resourceId: documentId,
      resourceType: 'document',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    return;
  }

  const document = await new DocumentModel(ctx.serverDB, ctx.userId).findById(documentId);
  if (!document) throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
};

const assertRequestAccess = async (
  ctx: DocumentRewriteRouterContext,
  requestId: string,
  action: 'edit' | 'view',
  expectedDocumentId?: string,
) => {
  const request = await ctx.documentRewriteService.findById(requestId);
  if (!request || (expectedDocumentId && request.documentId !== expectedDocumentId)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document rewrite request not found' });
  }
  await assertDocumentAccess(ctx, request.documentId, action);
  return request;
};

const toTRPCError = (error: unknown): never => {
  if (!(error instanceof Error)) throw error;
  const message = error.message;
  if (message.startsWith(DOCUMENT_REWRITE_REQUEST_INVALID)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
  if (message === DOCUMENT_REWRITE_REQUEST_NOT_FOUND) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document rewrite request not found' });
  }
  if (message === DOCUMENT_REWRITE_REQUEST_EXPIRED) {
    throw new TRPCError({ code: 'CONFLICT', message });
  }
  if (message === DOCUMENT_REWRITE_DISABLED) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Targeted collaborative rewrite is temporarily disabled',
    });
  }
  if (message === DOCUMENT_REWRITE_ACTIVE_LIMIT) {
    throw new TRPCError({ code: 'CONFLICT', message });
  }
  if (message.startsWith(DOCUMENT_REWRITE_CONTINUATION_DELETED)) {
    throw new TRPCError({ code: 'CONFLICT', message });
  }
  if (message.startsWith(DOCUMENT_REWRITE_CONTINUATION_CHANGED)) {
    throw new TRPCError({ code: 'CONFLICT', message });
  }
  if (
    message.startsWith(DOCUMENT_REWRITE_REQUEST_CONFLICT) ||
    message.startsWith(DOCUMENT_REWRITE_REVIEW_PROOF_INVALID) ||
    message.includes('Invalid document rewrite transition')
  ) {
    throw new TRPCError({ code: 'CONFLICT', message });
  }
  throw error;
};

export const documentRewriteRouter = router({
  create: documentRewriteProcedure.input(createSchema).mutation(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'edit');
    try {
      // Agent access is checked independently from document access. A caller
      // must not enqueue a request that a later worker cannot lawfully run.
      await assertAgentUsableBy(ctx.serverDB, input.agentId, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return await ctx.documentRewriteService.create({
        agentId: input.agentId,
        documentId: input.documentId,
        expiresAt: input.expiresAt,
        id: input.id,
        instruction: input.instruction,
        model: input.model,
        operationId: input.operationId,
        provider: input.provider,
        selection: input.selection as never,
        toolCallId: input.toolCallId,
        topicId: input.topicId,
      });
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  /** Create the next server-owned turn from a completed parent request. */
  continue: documentRewriteProcedure.input(continuationSchema).mutation(async ({ ctx, input }) => {
    await assertRequestAccess(ctx, input.parentRequestId, 'edit');
    try {
      const result = await ctx.documentRewriteService.continue(input.parentRequestId, {
        instruction: input.instruction,
        model: input.model,
        provider: input.provider,
      });
      if (!result) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      return result;
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  list: documentRewriteProcedure.input(listSchema).query(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'view');
    return ctx.documentRewriteService.list({
      documentId: input.documentId,
      limit: input.limit,
      statuses: input.statuses as DocumentRewriteRequestStatus[] | undefined,
    });
  }),

  /** Explicit alias for clients that prefer the document-qualified name. */
  listByDocument: documentRewriteProcedure.input(listSchema).query(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'view');
    return ctx.documentRewriteService.list({
      documentId: input.documentId,
      limit: input.limit,
      statuses: input.statuses as DocumentRewriteRequestStatus[] | undefined,
    });
  }),

  get: documentRewriteProcedure.input(requestDocumentIdSchema).query(async ({ ctx, input }) => {
    return assertRequestAccess(ctx, input.id, 'view', input.documentId);
  }),

  deleteSession: documentRewriteProcedure
    .input(deleteSessionSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDocumentAccess(ctx, input.documentId, 'edit');
      try {
        const result = await ctx.documentRewriteService.deleteSession(input);
        if (!result) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
        return result;
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  cancel: documentRewriteProcedure.input(cancelSchema).mutation(async ({ ctx, input }) => {
    await assertRequestAccess(ctx, input.id, 'edit');
    try {
      const result = await ctx.documentRewriteService.cancel(input.id, {
        attempt: input.attempt,
      });
      if (!result) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      return result;
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  retry: documentRewriteProcedure.input(retrySchema).mutation(async ({ ctx, input }) => {
    await assertRequestAccess(ctx, input.id, 'edit');
    try {
      const result = await ctx.documentRewriteService.retry(input.id, {
        attempt: input.attempt,
        delayMs: input.delayMs,
      });
      if (!result) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      return result;
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  review: documentRewriteProcedure.input(reviewSchema).mutation(async ({ ctx, input }) => {
    await assertRequestAccess(ctx, input.id, 'edit');
    try {
      const result = await ctx.documentRewriteService.settleReview(input.id, {
        attempt: input.attempt,
        expectedCommandId: input.expectedCommandId ?? input.commandId,
        stateVector: input.stateVector,
        status: input.status,
      });
      if (!result) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      return result;
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  /** Compatibility name matching the service method and UI terminology. */
  settleReview: documentRewriteProcedure.input(reviewSchema).mutation(async ({ ctx, input }) => {
    await assertRequestAccess(ctx, input.id, 'edit');
    try {
      const result = await ctx.documentRewriteService.settleReview(input.id, {
        attempt: input.attempt,
        expectedCommandId: input.expectedCommandId ?? input.commandId,
        stateVector: input.stateVector,
        status: input.status,
      });
      if (!result) throw new Error(DOCUMENT_REWRITE_REQUEST_NOT_FOUND);
      return result;
    } catch (error) {
      return toTRPCError(error);
    }
  }),
});

export type DocumentRewriteRouter = typeof documentRewriteRouter;

// Keep these limits visible to API consumers/tests without exposing any
// provider secret or room ticket material.
export const documentRewriteInputLimits = {
  errorMessage: DOCUMENT_REWRITE_ERROR_MAX_LENGTH,
  instruction: DOCUMENT_REWRITE_INSTRUCTION_MAX_LENGTH,
  quotedText: DOCUMENT_REWRITE_QUOTED_TEXT_MAX_LENGTH,
} as const;
