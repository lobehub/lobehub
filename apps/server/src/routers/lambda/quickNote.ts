import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';
import {
  QUICK_NOTE_ANALYZE_TRIGGERS,
  QUICK_NOTE_RESOURCE_TYPES,
  type TaskContext,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { QuickNoteModel } from '@/database/models/quickNote';
import { TaskModel } from '@/database/models/task';
import { QuickNoteRepository } from '@/database/repositories/quickNote';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { enqueueAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { QuickNoteProcessingService } from '@/server/services/quickNote';
import { isQuickNoteTextEquivalent } from '@/server/services/quickNote/contentChange';
import {
  QuickNoteApplyError,
  type QuickNoteApplyErrorCode,
} from '@/server/services/quickNote/executors/types';
import { assertQuickNoteEnabled } from '@/server/services/quickNote/featureGate';
import { QuickNoteProposalService } from '@/server/services/quickNote/proposals';
import { filterViewableResources } from '@/server/services/quickNote/resourceAccess';
import { renderQuickNoteSourceText } from '@/server/services/quickNote/sourceText';

const quickNoteProcedure = wsCompatProcedure
  .use(async ({ ctx, next }) => {
    await assertQuickNoteEnabled(ctx.userId);
    return next();
  })
  .use(serverDatabase);
const quickNoteWriteProcedure = quickNoteProcedure.use(withScopedPermission('agent:update'));

const idInput = z.object({ id: z.string() });
const editorDataSchema = z.record(z.string(), z.unknown());

const listInput = z
  .object({
    // `createdAt` is cast to `timestamptz` in SQL, so reject anything that is not the ISO
    // timestamp `nextCursor` emits instead of surfacing a Postgres error.
    cursor: z.object({ createdAt: z.string().datetime(), id: z.string().min(1) }).nullish(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .optional();

const analyzeInput = idInput.extend({
  trigger: z.enum(QUICK_NOTE_ANALYZE_TRIGGERS).default('manual'),
});

const createInput = z.object({
  collection: z.string().nullish(),
  content: z.string().default(''),
  editorData: editorDataSchema.optional(),
  location: z.string().nullish(),
  /** Product objects the capture was sent from; linked as `context` resources. */
  resources: z
    .array(
      z.object({
        id: z.string().min(1),
        selector: z.record(z.string(), z.unknown()).optional(),
        type: z.enum(QUICK_NOTE_RESOURCE_TYPES),
      }),
    )
    .max(20)
    .optional(),
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
  payload: z.record(z.string(), z.unknown()),
  proposalId: z.string().uuid(),
});

const decideProposalInput = z.object({
  /** Applying goes through `applyProposal`; this records a dismissal. */
  decisionStatus: z.literal('dismissed'),
  proposalId: z.string().uuid(),
  /** Optional user-supplied reason, stored with the dismissal. */
  reason: z.string().trim().max(500).optional(),
});

const APPLY_ERROR_CODES: Record<QuickNoteApplyErrorCode, TRPCError['code']> = {
  forbidden: 'FORBIDDEN',
  invalid_payload: 'BAD_REQUEST',
  not_found: 'NOT_FOUND',
  not_pending: 'CONFLICT',
  tool_failed: 'BAD_REQUEST',
  unsupported_target: 'BAD_REQUEST',
  unsupported_tool: 'BAD_REQUEST',
};

/** Maps a Proposal apply/validation failure onto a tRPC error the client can show. */
const rethrowApplyError = (error: unknown): never => {
  if (error instanceof QuickNoteApplyError) {
    throw new TRPCError({
      cause: error,
      code: APPLY_ERROR_CODES[error.code],
      message: error.message,
    });
  }
  throw error;
};

/**
 * Server-owned Quick Note CRUD and Agent Run entrypoints.
 *
 * The existing UI consumes this router through `quickNoteService`; capture
 * content remains Document-backed and every mutation is owner/workspace scoped.
 */
export const quickNoteRouter = router({
  agenticDetails: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const details = await model.queryAgenticDetails(input.id);
    // Workspace RBAC can change after linking, so a Document the caller lost access to is hidden.
    const resources = await filterViewableResources(
      { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
      details.resources,
      ({ resourceId, resourceType }) => ({ id: resourceId, type: resourceType }),
    );
    return { ...details, resources };
  }),

  /**
   * Applies a pending (current or stale) Proposal through its executor. Idempotent: applying again
   * returns the stored result with `applied: false`.
   */
  applyProposal: quickNoteWriteProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = new QuickNoteProposalService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      try {
        return await service.apply(input.proposalId);
      } catch (error) {
        return rethrowApplyError(error);
      }
    }),

  analyze: quickNoteWriteProcedure.input(analyzeInput).mutation(async ({ ctx, input }) => {
    if (
      input.trigger === 'automatic' &&
      !(await QuickNoteModel.isAutomaticAnalyzeEnabled(ctx.serverDB, ctx.userId))
    ) {
      return { accepted: false as const };
    }

    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const repo = new QuickNoteRepository(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const run = await repo.claimRun(input.id, {
      kind: 'analyze',
      renderSourceText: renderQuickNoteSourceText,
      trigger: input.trigger,
    });
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });

    try {
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
    } catch (error) {
      await model.failRun(
        run.id,
        { code: 'enqueue_failed', message: 'Failed to enqueue Quick Note Analyze' },
        {
          onlyUndispatched: true,
        },
      );
      throw error;
    }

    return { accepted: true as const, run };
  }),

  create: quickNoteWriteProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const repo = new QuickNoteRepository(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const settings = await QuickNoteModel.getAnalyzeSettings(ctx.serverDB, ctx.userId);
    // The database checks workspace and visibility only; RBAC and Document access need the server.
    const resources =
      input.resources &&
      (await filterViewableResources(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
        input.resources,
        (reference) => reference,
      ));
    return repo.create({
      ...input,
      resources,
      analyzeDueAt:
        settings.autoAnalyze.enabled && input.content?.trim()
          ? new Date(Date.now() + settings.autoAnalyze.idleDelayMs)
          : null,
    });
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
    const repo = new QuickNoteRepository(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    const deleted = await repo.delete(input.id);
    if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });
    return { success: true };
  }),

  decideProposal: quickNoteWriteProcedure
    .input(decideProposalInput)
    .mutation(async ({ ctx, input }) => {
      const service = new QuickNoteProposalService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const proposal = await service.dismiss(input.proposalId, input.reason);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      return proposal;
    }),

  /** Creates a Task from the note and its Comments and starts it; returns before any model call. */
  /**
   * One note with the same projection as a list item. Polls an active Run, and opens a note that
   * is not in the loaded list pages, without re-reading the whole list.
   */
  detail: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return (await model.queryDetail(input.id)) ?? null;
  }),

  dive: quickNoteWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const service = new QuickNoteProcessingService(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    );
    const result = await service.dive(input.id);
    if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });
    return result;
  }),

  /** One list page, newest first; pass the previous page's `nextCursor` to continue. */
  list: quickNoteProcedure.input(listInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryDetails({ cursor: input?.cursor, limit: input?.limit });
  }),

  listComments: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryComments(input.id);
  }),

  listProposals: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    return model.queryProposals(input.id);
  }),

  /**
   * Tasks this note started (applied `task` Proposals and Dives), newest first. These Tasks are
   * hidden from task lists, so the note sidebar is where they are found.
   */
  listTasks: quickNoteProcedure.input(idInput).query(async ({ ctx, input }) => {
    const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
    if (!(await model.findWithContent(input.id))) return [];

    const { tasks } = await new TaskModel(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    ).list({ limit: 50, quickNoteId: input.id });

    return tasks.map((task) => {
      const source = (task.context as TaskContext | null)?.source;
      return {
        createdAt: task.createdAt,
        id: task.id,
        identifier: task.identifier,
        name: task.name,
        proposalId: source?.proposalId ?? null,
        runId: source?.runId ?? null,
        status: task.status,
        updatedAt: task.updatedAt,
      };
    });
  }),

  updateComment: quickNoteWriteProcedure
    .input(updateCommentInput)
    .mutation(async ({ ctx, input }) => {
      const model = new QuickNoteModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);
      const comment = await model.updateComment(input.commentId, input);
      if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
      return comment;
    }),

  /**
   * Saves the note. Cosmetic edits (whitespace, punctuation, case) keep the Analyze schedule and
   * never invalidate Proposals; a real text edit restarts the quiet period and asks Agent Signal,
   * asynchronously, whether the meaning changed.
   */
  updateContent: quickNoteWriteProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const workspaceId = ctx.workspaceId ?? undefined;
    const repo = new QuickNoteRepository(ctx.serverDB, ctx.userId, workspaceId);
    const analyzeSettings = await QuickNoteModel.getAnalyzeSettings(ctx.serverDB, ctx.userId);
    const quietUntil = new Date(Date.now() + analyzeSettings.autoAnalyze.idleDelayMs);
    const updated = await repo.updateContent(input.id, {
      content: input.content,
      analyzeDueAt: analyzeSettings.autoAnalyze.enabled && input.content.trim() ? quietUntil : null,
      // Debounced meaning-change check: a real edit (re)arms it for when typing goes quiet, and
      // the sweep then compares the note as it is at that time. Staleness never waits for Auto
      // Analyze to be on.
      contentCheckDueAt: quietUntil,
      editorData: input.editorData,
      isEquivalentText: isQuickNoteTextEquivalent,
    });
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quick Note not found' });

    return updated;
  }),

  /** Overwrites a pending Proposal's payload after validating it for the Proposal's kind. */
  updateProposal: quickNoteWriteProcedure
    .input(updateProposalInput)
    .mutation(async ({ ctx, input }) => {
      const service = new QuickNoteProposalService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const proposal = await service
        .updatePayload(input.proposalId, input.payload)
        .catch(rethrowApplyError);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      return proposal;
    }),
});
