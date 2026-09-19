import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import {
  QUICK_NOTE_ANALYZE_TRIGGERS,
  QUICK_NOTE_PROPOSAL_DECISION_STATUSES,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { QuickNoteModel } from '@/database/models/quickNote';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { QuickNoteProcessingService } from '@/server/services/quickNote';
import { assertQuickNoteEnabled } from '@/server/services/quickNote/featureGate';

const quickNoteProcedure = wsCompatProcedure
  .use(async ({ ctx, next }) => {
    await assertQuickNoteEnabled(ctx.userId);
    return next();
  })
  .use(serverDatabase);
const quickNoteWriteProcedure = quickNoteProcedure.use(withScopedPermission('agent:update'));

const idInput = z.object({ id: z.string() });
const editorDataSchema = z.record(z.string(), z.unknown());

const analyzeInput = idInput.extend({
  trigger: z.enum(QUICK_NOTE_ANALYZE_TRIGGERS).default('manual'),
});

const createInput = z.object({
  collection: z.string().nullish(),
  content: z.string().default(''),
  editorData: editorDataSchema.optional(),
  location: z.string().nullish(),
  tags: z.array(z.string()).max(20).default([]),
});

const updateInput = z.object({
  content: z.string(),
  editorData: editorDataSchema,
  id: z.string(),
});

const createCommentInput = z.object({
  content: z.string().trim().min(1),
  editorData: editorDataSchema.optional(),
  quickNoteId: z.string(),
});

const updateCommentInput = z.object({
  commentId: z.string().uuid(),
  content: z.string().trim().min(1),
  editorData: editorDataSchema.optional(),
});

const updateProposalInput = z.object({
  content: z.string().trim().min(1),
  editorData: editorDataSchema,
  proposalId: z.string().uuid(),
});

const decideProposalInput = z.object({
  decisionStatus: z.enum(QUICK_NOTE_PROPOSAL_DECISION_STATUSES).exclude(['pending']),
  proposalId: z.string().uuid(),
});

/**
 * Server-owned Quick Note CRUD and Agent Run entrypoints.
 *
 * The existing UI consumes this router through `quickNoteService`; capture
 * content remains Document-backed and every mutation is owner/workspace scoped.
 */
export const quickNoteRouter = router({
  acceptProposal: quickNoteWriteProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const result = await model.acceptTaskProposal(input.proposalId);
      if (!result) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Current Task Proposal not found',
        });
      }
      return result;
    }),

  agenticDetails: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryAgenticDetails(input.id);
  }),

  analyze: quickNoteWriteProcedure.input(analyzeInput).mutation(async ({ ctx, input }) => {
    if (
      input.trigger === 'automatic' &&
      !(await QuickNoteModel.isAutomaticAnalyzeEnabled(ctx.serverDB, ctx.userId))
    ) {
      return { accepted: false as const };
    }

    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const run = await model.claimRun(input.id, { kind: 'analyze', trigger: input.trigger });
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });

    await enqueueAgentSignalSourceEvent(
      {
        payload: {
          quickNoteId: run.quickNoteId,
          runId: run.id,
          sourceHistoryId: run.sourceHistoryId,
          trigger: input.trigger,
          userId: ctx.userId,
        },
        scopeKey: `quick-note:${run.quickNoteId}`,
        sourceId: run.id,
        sourceType: AGENT_SIGNAL_SOURCE_TYPES.quickNoteAnalyzeRequested,
      },
      {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      },
    );

    return { accepted: true as const, run };
  }),

  create: quickNoteWriteProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.create(input);
  }),

  createComment: quickNoteWriteProcedure
    .input(createCommentInput)
    .mutation(async ({ ctx, input }) => {
      const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const comment = await model.createComment(input.quickNoteId, input);
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });
      return comment;
    }),

  delete: quickNoteWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const deleted = await model.delete(input.id);
    if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });
    return { success: true };
  }),

  decideProposal: quickNoteWriteProcedure
    .input(decideProposalInput)
    .mutation(async ({ ctx, input }) => {
      const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const proposal = await model.decideProposal(input.proposalId, input.decisionStatus);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      return proposal;
    }),

  dive: quickNoteWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const service = new QuickNoteProcessingService(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );
    const run = await service.startDive(input.id);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });
    return run;
  }),

  list: quickNoteProcedure.query(async ({ ctx }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryDetails();
  }),

  listComments: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryComments(input.id);
  }),

  listProposals: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryProposals(input.id);
  }),

  updateComment: quickNoteWriteProcedure
    .input(updateCommentInput)
    .mutation(async ({ ctx, input }) => {
      const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const comment = await model.updateComment(input.commentId, input);
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      return comment;
    }),

  updateContent: quickNoteWriteProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const analyzeSettings = await QuickNoteModel.getAnalyzeSettings(ctx.serverDB, ctx.userId);
    const updated = await model.updateContent(input.id, {
      content: input.content,
      analyzeDueAt:
        analyzeSettings.autoAnalyze.enabled && input.content.trim()
          ? new Date(Date.now() + analyzeSettings.autoAnalyze.idleDelayMs)
          : null,
      editorData: input.editorData,
    });
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });
    return updated;
  }),

  updateProposal: quickNoteWriteProcedure
    .input(updateProposalInput)
    .mutation(async ({ ctx, input }) => {
      const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const proposal = await model.updateProposal(input.proposalId, input);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      return proposal;
    }),
});
