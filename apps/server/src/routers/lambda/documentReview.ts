import {
  DOCUMENT_REVIEW_CHECK_EVENTS,
  DOCUMENT_REVIEW_CHECK_OUTCOMES,
  DOCUMENT_REVIEW_IMPACT_CATEGORIES,
  DOCUMENT_REVIEW_IMPACT_KINDS,
  DOCUMENT_REVIEW_IMPACT_SEVERITIES,
  DOCUMENT_REVIEW_IMPACT_STATUSES,
  DOCUMENT_REVIEW_RULE_SEVERITIES,
  DOCUMENT_REVIEW_SESSION_STATUSES,
  DocumentReviewTransitionError,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { wsProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND,
  DOCUMENT_REVIEW_NOT_FOUND,
  DOCUMENT_REVIEW_RULE_SET_EMPTY,
  DOCUMENT_REVIEW_RULE_SET_MISMATCH,
  DOCUMENT_REVIEW_RULE_SET_NOT_CONFIRMED,
  DocumentReviewModel,
} from '@/database/models/documentReview';
import { RbacModel } from '@/database/models/rbac';
import { workspaceMembers } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  createDocumentReviewImpactService,
  isDocumentImpactError,
} from '@/server/services/documentReviewImpact';
import { assertContentsNotInRestrictedKnowledgeBase } from '@/server/services/knowledgeBaseAccess';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';
import { isReviewServiceError, ReviewPlaybookService } from '@/server/services/review';

const idSchema = z.string().trim().min(1).max(255);
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(10_000);

const anchorSchema = z.object({
  end: z.number().int().min(0).optional(),
  invalid: z.boolean().optional(),
  label: z.string().max(200).optional(),
  prefix: z.string().max(200).optional(),
  quote: z.string().min(1).max(4000),
  start: z.number().int().min(0).optional(),
  suffix: z.string().max(200).optional(),
});

const suggestionSchema = z.object({
  original: z.string().max(10_000),
  replacement: z.string().max(10_000),
});

const impactSchema = z.object({
  category: z.enum(DOCUMENT_REVIEW_IMPACT_CATEGORIES),
  confidence: z.number().min(0).max(1).nullish(),
  kind: z.enum(DOCUMENT_REVIEW_IMPACT_KINDS),
  reason: longText,
  relatedAnchor: anchorSchema.nullish(),
  severity: z.enum(DOCUMENT_REVIEW_IMPACT_SEVERITIES).optional(),
  sourceAnchor: anchorSchema.nullish(),
  title: shortText,
  trigger: z.string().max(1000).nullish(),
});

const ruleSchema = z.object({
  instruction: longText,
  severity: z.enum(DOCUMENT_REVIEW_RULE_SEVERITIES).optional(),
  title: shortText,
});

type DocumentAccess = 'edit' | 'view';

const documentReviewProcedure = wsProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  let permissionCodes: Promise<string[]> | undefined;
  const getPermissionCodes = () => {
    permissionCodes ??= Promise.all([
      ctx.serverDB
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
            eq(workspaceMembers.userId, ctx.userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1),
      new RbacModel(ctx.serverDB, ctx.userId).getUserPermissions({ workspaceId: ctx.workspaceId }),
    ]).then(([membership, codes]) => (membership[0] ? codes : []));
    return permissionCodes;
  };

  const reviewModel = new DocumentReviewModel(ctx.serverDB, ctx.userId, ctx.workspaceId);

  /**
   * Every review surface is authorized against its parent document: reading a
   * review needs `view`, changing it needs `edit` — the same bar as reading or
   * editing the document body, including restricted knowledge bases.
   */
  const assertDocumentAccess = async (documentId: string, access: DocumentAccess) => {
    const grantedPermissions = await getPermissionCodes();
    if (grantedPermissions.length === 0) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Workspace membership required' });
    }
    await assertCanPerformResourceAction({
      action: access,
      db: ctx.serverDB,
      grantedPermissions,
      resourceId: documentId,
      resourceType: 'document',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    await assertContentsNotInRestrictedKnowledgeBase(ctx, [documentId]);
  };

  const notFound = (): never => {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document review resource not found' });
  };

  /** Resolve a child row to its document and authorize, or 404 without leaking existence. */
  const authorizeSession = async (sessionId: string, access: DocumentAccess) => {
    const session = await reviewModel.findSessionById(sessionId);
    if (!session) return notFound();
    await assertDocumentAccess(session.documentId, access);
    return session;
  };

  const authorizeRuleSet = async (ruleSetId: string, access: DocumentAccess) => {
    const ruleSet = await reviewModel.findRuleSetById(ruleSetId);
    if (!ruleSet) return notFound();
    await assertDocumentAccess(ruleSet.documentId, access);
    return ruleSet;
  };

  const authorizeRule = async (ruleId: string, access: DocumentAccess) => {
    const rule = await reviewModel.findRuleById(ruleId);
    if (!rule) return notFound();
    await authorizeRuleSet(rule.ruleSetId, access);
    return rule;
  };

  const authorizeImpact = async (impactId: string, access: DocumentAccess) => {
    const impact = await reviewModel.findImpactById(impactId);
    if (!impact) return notFound();
    await authorizeSession(impact.sessionId, access);
    return impact;
  };

  const authorizeCheckResult = async (checkResultId: string, access: DocumentAccess) => {
    const result = await reviewModel.findCheckResultById(checkResultId);
    if (!result) return notFound();
    await authorizeSession(result.sessionId, access);
    return result;
  };

  return next({
    ctx: {
      assertDocumentAccess,
      authorizeCheckResult,
      authorizeImpact,
      authorizeRule,
      authorizeRuleSet,
      authorizeSession,
      reviewModel,
    },
  });
});

/** Map model / transition errors to tRPC errors. Illegal transitions are 409. */
const mapError = (error: unknown): never => {
  if (isDocumentImpactError(error)) {
    const code =
      error.code === 'LLM_FAILED'
        ? 'BAD_GATEWAY'
        : error.code === 'SCHEMA_INVALID'
          ? 'INTERNAL_SERVER_ERROR'
          : [
                'DOCUMENT_NOT_FOUND',
                'SESSION_NOT_FOUND',
                'BASELINE_NOT_FOUND',
                'IMPACT_NOT_FOUND',
              ].includes(error.code)
            ? 'NOT_FOUND'
            : 'PRECONDITION_FAILED';

    throw new TRPCError({
      cause: { code: error.code, details: error.details },
      code,
      message: error.message,
    });
  }
  if (isReviewServiceError(error)) {
    const code =
      error.code === 'LLM_FAILED' || error.code === 'SCHEMA_INVALID'
        ? 'INTERNAL_SERVER_ERROR'
        : error.code === 'CHECK_RESULT_NOT_FOUND' || error.code === 'DOCUMENT_NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'ILLEGAL_TRANSITION' ||
              error.code === 'ANCHOR_LOST' ||
              error.code === 'ANCHOR_AMBIGUOUS'
            ? 'CONFLICT'
            : 'BAD_REQUEST';

    throw new TRPCError({ cause: { code: error.code }, code, message: error.message });
  }
  if (error instanceof DocumentReviewTransitionError) {
    throw new TRPCError({
      cause: { code: error.code, event: error.event, from: error.from },
      code: error.code === 'illegal_transition' ? 'CONFLICT' : 'BAD_REQUEST',
      message: error.message,
    });
  }
  if (error instanceof Error) {
    if ([DOCUMENT_REVIEW_NOT_FOUND, DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND].includes(error.message)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    }
    if (
      [
        DOCUMENT_REVIEW_RULE_SET_EMPTY,
        DOCUMENT_REVIEW_RULE_SET_MISMATCH,
        DOCUMENT_REVIEW_RULE_SET_NOT_CONFIRMED,
      ].includes(error.message)
    ) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
    }
  }
  throw error;
};

const run = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    return mapError(error);
  }
};

export const documentReviewRouter = router({
  // ---------------------------------------------------------------------------
  // Sessions & impacts
  // ---------------------------------------------------------------------------

  createSession: documentReviewProcedure
    .input(
      z.object({
        baseHistoryId: idSchema.nullish(),
        documentId: idSchema,
        ruleSetId: idSchema.nullish(),
        title: shortText.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.assertDocumentAccess(input.documentId, 'edit');
      return run(() => ctx.reviewModel.createSession(input));
    }),

  listSessions: documentReviewProcedure
    .input(z.object({ documentId: idSchema }))
    .query(async ({ ctx, input }) => {
      await ctx.assertDocumentAccess(input.documentId, 'view');
      return ctx.reviewModel.listSessions(input.documentId);
    }),

  getSession: documentReviewProcedure
    .input(z.object({ sessionId: idSchema }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.authorizeSession(input.sessionId, 'view');
      const [impacts, checkResults, ruleSet] = await Promise.all([
        ctx.reviewModel.listImpacts(session.id),
        ctx.reviewModel.listCheckResults(session.id),
        session.ruleSetId ? ctx.reviewModel.findRuleSetById(session.ruleSetId) : undefined,
      ]);
      return { checkResults, impacts, ruleSet: ruleSet ?? null, session };
    }),

  updateSession: documentReviewProcedure
    .input(
      z.object({
        baseHistoryId: idSchema.nullish(),
        ruleSetId: idSchema.nullish(),
        sessionId: idSchema,
        status: z.enum(DOCUMENT_REVIEW_SESSION_STATUSES).optional(),
        title: shortText.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionId, ...value } = input;
      await ctx.authorizeSession(sessionId, 'edit');
      return run(
        async () =>
          (await ctx.reviewModel.updateSession(sessionId, value)) ??
          mapError(new Error(DOCUMENT_REVIEW_NOT_FOUND)),
      );
    }),

  deleteSession: documentReviewProcedure
    .input(z.object({ sessionId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'edit');
      return { deleted: await ctx.reviewModel.deleteSession(input.sessionId) };
    }),

  listImpacts: documentReviewProcedure
    .input(z.object({ sessionId: idSchema }))
    .query(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'view');
      return ctx.reviewModel.listImpacts(input.sessionId);
    }),

  replaceImpacts: documentReviewProcedure
    .input(z.object({ items: z.array(impactSchema).max(200), sessionId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'edit');
      return run(() => ctx.reviewModel.replaceImpacts(input.sessionId, input.items));
    }),

  updateImpactStatus: documentReviewProcedure
    .input(z.object({ impactId: idSchema, status: z.enum(DOCUMENT_REVIEW_IMPACT_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeImpact(input.impactId, 'edit');
      return ctx.reviewModel.updateImpactStatus(input.impactId, input.status);
    }),

  /**
   * Analyse the session's baseline against the current body and persist the
   * resulting impact items (replacing any previous run). `baseHistoryId`
   * selects another baseline for this run and pins it on the session.
   */
  analyzeImpacts: documentReviewProcedure
    .input(z.object({ baseHistoryId: idSchema.nullish(), sessionId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'edit');
      return run(() =>
        createDocumentReviewImpactService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).analyze(input),
      );
    }),

  /** Impact item plus both original excerpts, assembled for a follow-up turn. */
  getImpactFollowUpContext: documentReviewProcedure
    .input(z.object({ impactId: idSchema, question: z.string().max(2000).optional() }))
    .query(async ({ ctx, input }) => {
      await ctx.authorizeImpact(input.impactId, 'view');
      return run(() =>
        createDocumentReviewImpactService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).buildFollowUpContext(input),
      );
    }),

  // ---------------------------------------------------------------------------
  // Rule sets
  // ---------------------------------------------------------------------------

  createRuleSet: documentReviewProcedure
    .input(
      z.object({
        description: z.string().max(10_000).nullish(),
        documentId: idSchema,
        rules: z.array(ruleSchema).max(100).optional(),
        title: shortText,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.assertDocumentAccess(input.documentId, 'edit');
      return run(() => ctx.reviewModel.createRuleSet(input));
    }),

  listRuleSets: documentReviewProcedure
    .input(z.object({ documentId: idSchema }))
    .query(async ({ ctx, input }) => {
      await ctx.assertDocumentAccess(input.documentId, 'view');
      return ctx.reviewModel.listRuleSets(input.documentId);
    }),

  getRuleSet: documentReviewProcedure
    .input(z.object({ ruleSetId: idSchema }))
    .query(async ({ ctx, input }) => ctx.authorizeRuleSet(input.ruleSetId, 'view')),

  updateRuleSet: documentReviewProcedure
    .input(
      z.object({
        description: z.string().max(10_000).nullish(),
        ruleSetId: idSchema,
        title: shortText.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ruleSetId, ...value } = input;
      await ctx.authorizeRuleSet(ruleSetId, 'edit');
      return ctx.reviewModel.updateRuleSet(ruleSetId, value);
    }),

  deleteRuleSet: documentReviewProcedure
    .input(z.object({ ruleSetId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeRuleSet(input.ruleSetId, 'edit');
      return { deleted: await ctx.reviewModel.deleteRuleSet(input.ruleSetId) };
    }),

  confirmRuleSet: documentReviewProcedure
    .input(z.object({ ruleSetId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeRuleSet(input.ruleSetId, 'edit');
      return run(() => ctx.reviewModel.confirmRuleSet(input.ruleSetId));
    }),

  addRule: documentReviewProcedure
    .input(ruleSchema.extend({ ruleSetId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const { ruleSetId, ...rule } = input;
      await ctx.authorizeRuleSet(ruleSetId, 'edit');
      return run(() => ctx.reviewModel.addRule(ruleSetId, rule));
    }),

  updateRule: documentReviewProcedure
    .input(ruleSchema.partial().extend({ ruleId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const { ruleId, ...value } = input;
      await ctx.authorizeRule(ruleId, 'edit');
      return ctx.reviewModel.updateRule(ruleId, value);
    }),

  removeRule: documentReviewProcedure
    .input(z.object({ ruleId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeRule(input.ruleId, 'edit');
      return { deleted: await ctx.reviewModel.removeRule(input.ruleId) };
    }),

  // ---------------------------------------------------------------------------
  // Check results
  // ---------------------------------------------------------------------------

  initializeChecks: documentReviewProcedure
    .input(z.object({ sessionId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'edit');
      return run(() => ctx.reviewModel.initializeChecks(input.sessionId));
    }),

  listCheckResults: documentReviewProcedure
    .input(z.object({ sessionId: idSchema }))
    .query(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'view');
      return ctx.reviewModel.listCheckResults(input.sessionId);
    }),

  updateSuggestion: documentReviewProcedure
    .input(z.object({ checkResultId: idSchema, suggestion: suggestionSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeCheckResult(input.checkResultId, 'edit');
      return ctx.reviewModel.updateSuggestion(input.checkResultId, input.suggestion);
    }),

  /**
   * The only way to change a check status. Clients submit an event, never a
   * status; the server derives the next status and rejects illegal moves
   * (e.g. `apply_suggestion` can only ever land on `needs_recheck`, and only a
   * `check` event can produce `passed`).
   */
  transitionCheck: documentReviewProcedure
    .input(
      z.object({
        checkResultId: idSchema,
        event: z.enum(DOCUMENT_REVIEW_CHECK_EVENTS),
        evidence: z.array(anchorSchema).max(50).nullish(),
        explanation: z.string().max(10_000).nullish(),
        outcome: z.enum(DOCUMENT_REVIEW_CHECK_OUTCOMES).optional(),
        suggestion: suggestionSchema.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { checkResultId, ...params } = input;
      await ctx.authorizeCheckResult(checkResultId, 'edit');
      return run(async () => {
        const result = await ctx.reviewModel.transitionCheck(checkResultId, params);
        return result ?? mapError(new Error(DOCUMENT_REVIEW_NOT_FOUND));
      });
    }),

  /** The document body changed outside the checklist: stale results need a re-check. */
  invalidateDocumentChecks: documentReviewProcedure
    .input(z.object({ documentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.assertDocumentAccess(input.documentId, 'edit');
      return { invalidated: await ctx.reviewModel.invalidateDocumentChecks(input.documentId) };
    }),

  // ---------------------------------------------------------------------------
  // Rule checks (Playbook)
  // ---------------------------------------------------------------------------

  /**
   * Agent-proposed rules from a document body or a description. Returns drafts
   * only — nothing is written until the user confirms them into a rule set.
   */
  proposeRules: documentReviewProcedure
    .input(
      z.object({
        description: z.string().trim().min(10).max(1000).optional(),
        documentId: idSchema,
        limit: z.number().int().min(1).max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.assertDocumentAccess(input.documentId, 'view');
      return run(() =>
        new ReviewPlaybookService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).proposeRules(input),
      );
    }),

  /** Check the checklist's `unchecked` items (all, or exactly the given ones). */
  runChecks: documentReviewProcedure
    .input(
      z.object({
        checkResultIds: z.array(idSchema).max(100).optional(),
        sessionId: idSchema,
        userContext: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'edit');
      return run(() =>
        new ReviewPlaybookService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).runChecks(input),
      );
    }),

  /**
   * Re-check only `needs_recheck` items — the only path from `needs_recheck`
   * back to `passed` / `failed` / `uncertain`. Omit ids to re-check all of them.
   */
  recheckChecks: documentReviewProcedure
    .input(
      z.object({
        checkResultIds: z.array(idSchema).max(100).optional(),
        sessionId: idSchema,
        userContext: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeSession(input.sessionId, 'edit');
      return run(() =>
        new ReviewPlaybookService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).recheckChecks(input),
      );
    }),

  /** Generate a fix suggestion for a failed / uncertain item. Status is untouched. */
  suggestFix: documentReviewProcedure
    .input(
      z.object({
        checkResultId: idSchema,
        userInstruction: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeCheckResult(input.checkResultId, 'edit');
      return run(() =>
        new ReviewPlaybookService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).suggestFix(input),
      );
    }),

  /**
   * Apply a user-edited suggestion through the editor pipeline and mark the item
   * `needs_recheck`. Applying a fix never verifies it.
   */
  applySuggestion: documentReviewProcedure
    .input(z.object({ appliedText: z.string().trim().min(1).max(10_000), checkResultId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.authorizeCheckResult(input.checkResultId, 'edit');
      return run(() =>
        new ReviewPlaybookService({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }).applySuggestion(input),
      );
    }),
});
