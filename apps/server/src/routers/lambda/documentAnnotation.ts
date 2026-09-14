import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DocumentModel } from '@/database/models/document';
import {
  DOCUMENT_ANNOTATION_DOCUMENT_NOT_FOUND,
  DOCUMENT_ANNOTATION_NOT_FOUND,
  DocumentAnnotationConflictError,
} from '@/database/models/documentAnnotation';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentAnnotationService } from '@/server/services/documentAnnotation';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

const idSchema = z.string().trim().min(1).max(255);
const jsonSchema = z.json();
const statusSchema = z.enum(['active', 'resolved', 'orphaned', 'deleted']);
const dateSchema = z.string().datetime({ offset: true }).optional();
const nodeKeysSchema = z.array(idSchema).max(500).optional();

/** Editor-compatible annotation body accepted by create/upsert/migration. */
const annotationRecordSchema = z.object({
  anchorMetadata: z.record(z.string(), jsonSchema).nullable().optional(),
  author: jsonSchema.optional(),
  createdAt: dateSchema,
  id: idSchema,
  kind: z.string().trim().min(1).max(100).optional(),
  nodeKeys: nodeKeysSchema,
  payload: jsonSchema.optional(),
  quotedText: z.string().max(100_000).optional(),
  status: statusSchema.optional(),
  updatedAt: dateSchema,
  version: z.number().int().positive().optional(),
});

const documentIdSchema = z.object({ documentId: idSchema });
const expectedVersionSchema = z.object({ expectedVersion: z.number().int().positive().optional() });

const recordEnvelopeSchema = documentIdSchema
  .merge(expectedVersionSchema)
  .extend({ record: annotationRecordSchema });

/** Also accept a flat record to keep the API convenient for mutation events. */
const flatRecordSchema = documentIdSchema
  .merge(expectedVersionSchema)
  .extend(annotationRecordSchema.shape);

const recordMutationSchema = z
  .union([recordEnvelopeSchema, flatRecordSchema])
  .transform((input) => {
    if ('record' in input) return input;
    const { documentId, expectedVersion, ...record } = input;
    return { documentId, expectedVersion, record };
  });

const updatePatchSchema = z
  .object({
    anchorMetadata: z.record(z.string(), jsonSchema).nullable().optional(),
    author: jsonSchema.optional(),
    kind: z.string().trim().min(1).max(100).optional(),
    nodeKeys: nodeKeysSchema,
    payload: jsonSchema.optional(),
    quotedText: z.string().max(100_000).optional(),
    status: statusSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'At least one annotation field is required',
  });

const updateSchema = documentIdSchema
  .merge(expectedVersionSchema)
  .extend({ id: idSchema, patch: updatePatchSchema });

const statusMutationSchema = documentIdSchema
  .merge(expectedVersionSchema)
  .extend({ id: idSchema, status: statusSchema });

const deleteSchema = documentIdSchema.merge(expectedVersionSchema).extend({ id: idSchema });

const listSchema = documentIdSchema.extend({
  includeDeleted: z.boolean().optional(),
});

const bulkSchema = documentIdSchema.extend({
  records: z.array(annotationRecordSchema).max(1000),
});

type AnnotationContext = {
  documentAnnotationService: DocumentAnnotationService;
  serverDB: Parameters<typeof assertCanPerformResourceAction>[0]['db'];
  userId: string;
  workspaceId?: string | null;
};

const documentAnnotationProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      documentAnnotationService: new DocumentAnnotationService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ),
    },
  });
});

/**
 * Reuse the document resource authorization boundary for both annotations and
 * the editor itself. In personal mode DocumentModel provides the owner-only
 * scope; in workspace mode the resource permission evaluator handles public /
 * private visibility, collaborator levels, and RBAC ceilings.
 */
const assertDocumentAccess = async (
  ctx: Pick<AnnotationContext, 'serverDB' | 'userId' | 'workspaceId'>,
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

const toTRPCError = (error: unknown): never => {
  if (error instanceof DocumentAnnotationConflictError) {
    throw new TRPCError({
      cause: { data: { current: error.current } },
      code: 'CONFLICT',
      message: error.message,
    });
  }
  if (
    error instanceof Error &&
    [DOCUMENT_ANNOTATION_DOCUMENT_NOT_FOUND, DOCUMENT_ANNOTATION_NOT_FOUND].includes(error.message)
  ) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document annotation not found' });
  }
  throw error;
};

export const documentAnnotationRouter = router({
  listByDocument: documentAnnotationProcedure.input(listSchema).query(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'view');
    return ctx.documentAnnotationService.listByDocument(input.documentId, {
      includeDeleted: input.includeDeleted,
    });
  }),

  get: documentAnnotationProcedure
    .input(documentIdSchema.extend({ id: idSchema }))
    .query(async ({ ctx, input }) => {
      await assertDocumentAccess(ctx, input.documentId, 'view');
      const annotation = await ctx.documentAnnotationService.findById(input.documentId, input.id);
      if (!annotation)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document annotation not found' });
      return annotation;
    }),

  create: documentAnnotationProcedure
    .input(recordMutationSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDocumentAccess(ctx, input.documentId, 'edit');
      try {
        const result = await ctx.documentAnnotationService.create(input.documentId, input.record);
        return { ...result, record: result.annotation };
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  upsert: documentAnnotationProcedure
    .input(recordMutationSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDocumentAccess(ctx, input.documentId, 'edit');
      try {
        const result = await ctx.documentAnnotationService.upsert(
          input.documentId,
          input.record,
          input.expectedVersion,
        );
        return { ...result, record: result.annotation };
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  bulkUpsertLegacy: documentAnnotationProcedure
    .input(bulkSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDocumentAccess(ctx, input.documentId, 'edit');
      try {
        const result = await ctx.documentAnnotationService.bulkUpsertLegacy(
          input.documentId,
          input.records,
        );
        return { ...result, records: result.annotations };
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  update: documentAnnotationProcedure.input(updateSchema).mutation(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'edit');
    try {
      const result = await ctx.documentAnnotationService.update(
        input.documentId,
        input.id,
        input.patch,
        input.expectedVersion,
      );
      return { ...result, record: result.annotation };
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  updateStatus: documentAnnotationProcedure
    .input(statusMutationSchema)
    .mutation(async ({ ctx, input }) => {
      await assertDocumentAccess(ctx, input.documentId, 'edit');
      try {
        const result = await ctx.documentAnnotationService.updateStatus(
          input.documentId,
          input.id,
          input.status,
          input.expectedVersion,
        );
        return { ...result, record: result.annotation };
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  softDelete: documentAnnotationProcedure.input(deleteSchema).mutation(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'edit');
    try {
      const result = await ctx.documentAnnotationService.softDelete(
        input.documentId,
        input.id,
        input.expectedVersion,
      );
      return { ...result, record: result.annotation };
    } catch (error) {
      return toTRPCError(error);
    }
  }),

  /** Alias used by hosts that map the editor's remove mutation to REST verbs. */
  remove: documentAnnotationProcedure.input(deleteSchema).mutation(async ({ ctx, input }) => {
    await assertDocumentAccess(ctx, input.documentId, 'edit');
    try {
      const result = await ctx.documentAnnotationService.remove(
        input.documentId,
        input.id,
        input.expectedVersion,
      );
      return { ...result, record: result.annotation };
    } catch (error) {
      return toTRPCError(error);
    }
  }),
});

export type DocumentAnnotationRouter = typeof documentAnnotationRouter;
