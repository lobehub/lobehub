import { verifyCheckDefinitionSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { verifyProcedure, verifyWriteProcedure } from './procedures';
import { onFailSchema, verifierTypeSchema } from './schemas';

/** Run-policy knobs persisted on a rubric (see VerifyRubricConfig). */
const rubricConfigSchema = z.object({
  maxRepairRounds: z.number().int().min(0).max(5).optional(),
});

// A criteria list links a runtime-sized set of documents; cap the per-document reads.
const CRITERION_DOCUMENT_LOAD_CONCURRENCY = 5;

export const criteriaRouter = router({
  // ---- criteria (reusable atomic standards) ----
  createCriterion: verifyWriteProcedure
    .input(
      z.object({
        definition: verifyCheckDefinitionSchema.optional(),
        tags: z.array(z.string()).max(50).optional(),
        description: z.string().optional(),
        documentId: z.string().optional(),
        onFail: onFailSchema.optional(),
        required: z.boolean().optional(),
        title: z.string(),
        verifierConfig: z.record(z.string(), z.unknown()).optional(),
        verifierType: verifierTypeSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.criterionModel.create(input)),
  deleteCriterion: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.criterionModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!criterion) return;
      assertWorkspaceRowManageable(ctx, criterion.userId, 'verify criterion');
      return ctx.criterionModel.delete(input.id);
    }),
  forkRubricCriteria: verifyWriteProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => ctx.criterionModel.forkRubricCriteria(input.ids)),
  /**
   * Resolve a specific criteria id list (e.g. the ones bound to a goal), in
   * input order. Each row carries `instruction` resolved from its linked
   * document — the judge rule must be inspectable and editable where the
   * criteria are shown, not an invisible value edits would silently replace.
   */
  getCriteria: verifyProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      if (input.ids.length === 0) return [];
      const rows = await ctx.criterionModel.findByIds(input.ids);
      const documentIds = [
        ...new Set(rows.flatMap((row) => (row.documentId ? [row.documentId] : []))),
      ];
      const documents = await pMap(documentIds, (id) => ctx.documentModel.findById(id), {
        concurrency: CRITERION_DOCUMENT_LOAD_CONCURRENCY,
      });
      const contentByDocId = new Map(
        documents.flatMap((doc) => (doc ? [[doc.id, doc.content ?? undefined] as const] : [])),
      );
      const byId = new Map(
        rows.map((row) => [
          row.id,
          {
            ...row,
            instruction: row.documentId ? contentByDocId.get(row.documentId) : undefined,
          },
        ]),
      );
      return input.ids.map((id) => byId.get(id)).filter(Boolean);
    }),
  listCriteria: verifyProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          tags: z.array(z.string()).optional(),
          includeArchived: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => ctx.criterionModel.query(input)),
  getCriterionResults: verifyProcedure
    .input(z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      if (!(await ctx.criterionModel.findById(input.id)))
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Check asset not found' });
      return ctx.resultModel.listByCriterion(input.id, input.limit);
    }),
  updateCriterion: verifyWriteProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          definition: verifyCheckDefinitionSchema.nullish(),
          tags: z.array(z.string()).max(50).optional(),
          archivedAt: z.coerce.date().nullish(),
          description: z.string().nullish(),
          documentId: z.string().nullish(),
          onFail: onFailSchema.optional(),
          required: z.boolean().optional(),
          title: z.string().optional(),
          verifierConfig: z.record(z.string(), z.unknown()).optional(),
          verifierType: verifierTypeSchema.optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const criterion = await ctx.criterionModel.findById(input.id);
      if (!criterion) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification criterion not found' });
      }
      assertWorkspaceRowManageable(ctx, criterion.userId, 'verify criterion');
      return ctx.criterionModel.update(input.id, input.value);
    }),
  // ---- rubrics (named criteria groups) ----
  createRubric: verifyWriteProcedure
    .input(
      z.object({
        config: rubricConfigSchema.optional(),
        description: z.string().optional(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => ctx.rubricModel.create(input)),
  deleteRubric: verifyWriteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.rubricModel.findById(input.id);
      // Missing row → keep the delete idempotent, nothing to authorize.
      if (!rubric) return;
      assertWorkspaceRowManageable(ctx, rubric.userId, 'verify rubric');
      return ctx.rubricModel.delete(input.id);
    }),
  getRubric: verifyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => ctx.rubricModel.findById(input.id)),
  getRubricCriteria: verifyProcedure
    .input(z.object({ rubricId: z.string() }))
    .query(async ({ ctx, input }) => ctx.rubricModel.getCriteria(input.rubricId)),
  listRubrics: verifyProcedure.query(async ({ ctx }) => ctx.rubricModel.query()),
  setRubricCriteria: verifyWriteProcedure
    .input(
      z.object({
        criteria: z.array(z.object({ criterionId: z.string(), sortOrder: z.number().optional() })),
        rubricId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.rubricModel.findById(input.rubricId);
      if (!rubric) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification rubric not found' });
      }
      assertWorkspaceRowManageable(ctx, rubric.userId, 'verify rubric');
      return ctx.rubricModel.setCriteria(input.rubricId, input.criteria);
    }),
  updateRubric: verifyWriteProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          config: rubricConfigSchema.optional(),
          description: z.string().nullish(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rubric = await ctx.rubricModel.findById(input.id);
      if (!rubric) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Verification rubric not found' });
      }
      assertWorkspaceRowManageable(ctx, rubric.userId, 'verify rubric');
      return ctx.rubricModel.update(input.id, input.value);
    }),
});
