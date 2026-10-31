import type {
  AcceptanceAccessRequest,
  AcceptanceAccessRequestStatus,
  AcceptanceAttachment,
  AcceptanceCommentAuthor,
  AcceptanceCommentItem,
  AcceptanceCommentList,
  AcceptanceCommentReaction,
} from '@lobechat/types';
import { acceptanceCommentTimeSchema, reviewAnchorSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  ACCEPTANCE_COMMENT_PARENT_NOT_FOUND,
  ACCEPTANCE_COMMENT_RATE_LIMITED,
  AcceptanceCommentModel,
  acceptanceReactionClientId,
} from '@/database/models/acceptanceComment';
import {
  agents,
  users,
  verifyCheckResults,
  verifyEvidence,
  verifyRuns,
  workspaceMembers,
} from '@/database/schemas';
import type { AcceptanceCommentRow } from '@/database/schemas/acceptanceComment';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { notifyAcceptance } from '@/server/services/acceptanceReview/events';
import { createEvidenceFileResolver } from '@/server/services/verify/evidenceFiles';

import { resolveAcceptanceCommentAccess } from './_helpers/acceptanceCommentAccess';
import { canManageAcceptance } from './_helpers/acceptanceWriteScope';

const rectSchema = z.object({
  height: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const createSchema = z
  .object({
    acceptanceId: z.string().min(1),
    anchor: z
      .object({
        checkItemId: z.string().min(1).max(255),
        evidenceId: z.string().uuid(),
        rect: rectSchema,
        time: acceptanceCommentTimeSchema.optional(),
      })
      .optional(),
    attachments: z
      .array(z.object({ fileId: z.string().trim().min(1).max(255) }))
      .max(9)
      .optional(),
    authorAgentId: z.string().trim().min(1).max(255).optional(),
    clientId: z.string().trim().min(1).max(255),
    content: z.string().trim().max(10_000),
    contextRunId: z.string().uuid().optional(),
    // The editor's own tree — schemaless by nature, and never interpreted here.
    editorData: z.unknown().optional(),
    kind: z.enum(['approval', 'comment', 'proposal']).optional(),
    parentCommentId: z.string().trim().min(1).max(64).optional(),
    source: reviewAnchorSchema.optional(),
  })
  .refine(
    (value) =>
      value.kind === 'approval' || value.content.length > 0 || (value.attachments?.length ?? 0) > 0,
    // A screenshot on its own is a complete remark — "this is what I see".
    { message: 'Comment content is required', path: ['content'] },
  )
  .refine((value) => !(value.parentCommentId && value.anchor), {
    message: 'A reply cannot carry its own anchor',
    path: ['anchor'],
  })
  .refine((value) => !(value.parentCommentId && value.source), {
    message: 'A reply cannot carry its own page anchor',
    path: ['source'],
  })
  .refine((value) => !(value.parentCommentId && value.kind === 'approval'), {
    message: 'An approval is a thread root',
    path: ['kind'],
  })
  .refine((value) => value.kind !== 'proposal' || Boolean(value.contextRunId), {
    message: "A proposal belongs to a round, so it needs that round's id",
    path: ['contextRunId'],
  });

/** Reads addressed purely by acceptance id — visibility is checked in the handler. */
const readProcedure = publicProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) =>
    next({ ctx: { acceptanceCommentModel: new AcceptanceCommentModel(ctx.serverDB) } }),
  );

const writeProcedure = authedProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) =>
    next({ ctx: { acceptanceCommentModel: new AcceptanceCommentModel(ctx.serverDB) } }),
  );

const deactivatedAuthor: AcceptanceCommentAuthor = {
  avatar: null,
  fullName: null,
  id: null,
  status: 'deactivated',
  type: 'user',
  username: null,
};

/**
 * Join author profiles and round indexes onto raw rows. Membership status is
 * read against the acceptance's own workspace so a departed teammate renders
 * as `former` rather than vanishing from the discussion.
 *
 * That inference only holds on a delivery nobody outside could write on. Once
 * the link is public, most people in the discussion never had a seat in that
 * workspace and "left" would be a lie about every one of them, so the label is
 * dropped there rather than guessed.
 */
const enrich = async (
  db: LobeChatDatabase,
  rows: AcceptanceCommentRow[],
  scope: {
    /** Whether this reader may take down a remark that is not theirs. */
    canModerate?: boolean;
    ownerUserId: string;
    userId?: string | null;
    /** Only a private delivery can prove a non-member once had a seat. */
    visibility: AcceptanceItem['visibility'];
    workspaceId: string | null;
  },
): Promise<AcceptanceCommentItem[]> => {
  const authorIds = [
    ...new Set(rows.flatMap((row) => (row.authorUserId ? [row.authorUserId] : []))),
  ];
  const runIds = [...new Set(rows.flatMap((row) => (row.contextRunId ? [row.contextRunId] : [])))];
  const agentIds = [
    ...new Set(rows.flatMap((row) => (row.authorAgentId ? [row.authorAgentId] : []))),
  ];
  // Resolved as the acceptance's owner, the way the bundle resolves evidence and
  // reject attachments: the uploader may be a reviewer, and the visibility gate
  // has already been applied above.
  const attachmentIds = [
    ...new Set(rows.flatMap((row) => (row.attachments ?? []).map((item) => item.fileId))),
  ];
  const resolveFile = createEvidenceFileResolver(
    db,
    scope.ownerUserId,
    scope.workspaceId ?? undefined,
  );
  const fileById = new Map<string, AcceptanceAttachment>(
    await Promise.all(
      attachmentIds.map(async (id): Promise<[string, AcceptanceAttachment]> => {
        const meta = await resolveFile(id);
        return [id, { id, name: meta.fileName ?? undefined, url: meta.fileUrl }];
      }),
    ),
  );

  const [profiles, memberships, runs, agentRows] = await Promise.all([
    authorIds.length
      ? db
          .select({
            avatar: users.avatar,
            fullName: users.fullName,
            id: users.id,
            username: users.username,
          })
          .from(users)
          .where(inArray(users.id, authorIds))
      : [],
    authorIds.length && scope.workspaceId
      ? db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, scope.workspaceId),
              inArray(workspaceMembers.userId, authorIds),
              isNull(workspaceMembers.deletedAt),
            ),
          )
      : [],
    runIds.length
      ? db
          .select({ id: verifyRuns.id, roundIndex: verifyRuns.roundIndex })
          .from(verifyRuns)
          .where(inArray(verifyRuns.id, runIds))
      : [],
    agentIds.length
      ? db
          .select({ avatar: agents.avatar, id: agents.id, name: agents.name, title: agents.title })
          .from(agents)
          .where(inArray(agents.id, agentIds))
      : [],
  ]);

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeIds = new Set(memberships.map(({ userId }) => userId));
  const roundByRun = new Map(runs.map((run) => [run.id, run.roundIndex]));
  const agentById = new Map(agentRows.map((agent) => [agent.id, agent]));

  /**
   * An agent-signed row shows the agent. The account whose key carried it is
   * still recorded and still governs deletion — it is just not who "said" it,
   * any more than a bot comment on a pull request is attributed to the token
   * holder.
   */
  const getAuthor = (
    authorUserId: string | null,
    authorAgentId?: string | null,
  ): AcceptanceCommentAuthor => {
    const agent = authorAgentId ? agentById.get(authorAgentId) : undefined;
    if (agent)
      return {
        avatar: agent.avatar,
        fullName: agent.name ?? agent.title ?? null,
        id: agent.id,
        status: 'active',
        type: 'agent',
        username: null,
      };
    const profile = authorUserId ? profileById.get(authorUserId) : undefined;
    if (!profile) return deactivatedAuthor;
    // Without a workspace there is no membership to lapse from, and on a public
    // delivery a non-member is an invited reader rather than a departed one.
    const active =
      !scope.workspaceId || scope.visibility !== 'private' || activeIds.has(profile.id);
    return { ...profile, status: active ? 'active' : 'former', type: 'user' as const };
  };

  // Reaction rows are folded into the comment they answer and never surface as
  // items of their own: the page renders chips, not one-emoji messages.
  const authorLabel = (authorUserId: string | null) => {
    const author = getAuthor(authorUserId);
    return author.fullName || author.username || '';
  };
  const reactionsByComment = new Map<string, Map<string, AcceptanceCommentReaction>>();
  for (const row of rows) {
    if (row.kind !== 'reaction' || !row.parentCommentId || row.deletedAt) continue;
    const byEmoji = reactionsByComment.get(row.parentCommentId) ?? new Map();
    const current = byEmoji.get(row.content) ?? {
      authorNames: [],
      count: 0,
      emoji: row.content,
      mine: false,
    };
    const name = authorLabel(row.authorUserId);
    byEmoji.set(row.content, {
      authorNames: name ? [...current.authorNames, name] : current.authorNames,
      count: current.count + 1,
      emoji: row.content,
      mine: current.mine || (Boolean(scope.userId) && row.authorUserId === scope.userId),
    });
    reactionsByComment.set(row.parentCommentId, byEmoji);
  }

  // The reporter's console errors and user agent are diagnostics for whoever
  // fixes the page, not something every link holder should read.
  const sourceOf = (row: AcceptanceCommentRow) => {
    if (!row.source) return null;
    const own = Boolean(scope.userId) && row.authorUserId === scope.userId;
    if (own || scope.canModerate) return row.source;
    const { env: _env, ...rest } = row.source;
    return rest;
  };

  const timeOf = (row: AcceptanceCommentRow) => {
    if (row.anchorType !== 'evidence') return null;
    const parsed = acceptanceCommentTimeSchema.safeParse(row.metadata?.evidenceAnchor?.time);
    return parsed.success ? parsed.data : null;
  };

  return rows
    .filter((row) => row.kind !== 'reaction')
    .map((row) => ({
      accessRequest: row.kind === 'access_request' ? (row.metadata?.accessRequest ?? null) : null,
      acceptanceId: row.acceptanceId,
      anchorType: row.anchorType,
      attachments: (row.attachments ?? []).flatMap((item) => {
        const file = fileById.get(item.fileId);
        return file ? [file] : [];
      }),
      author: getAuthor(row.authorUserId, row.authorAgentId),
      authorAgentId: row.authorAgentId,
      authorUserId: row.authorUserId,
      canDelete:
        !row.deletedAt &&
        Boolean(scope.userId) &&
        (row.authorUserId === scope.userId || Boolean(scope.canModerate)),
      checkItemId: row.checkItemId,
      clientId: row.clientId,
      content: row.content,
      contextRoundIndex: row.contextRunId ? (roundByRun.get(row.contextRunId) ?? null) : null,
      contextRunId: row.contextRunId,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      editorData: row.editorData ?? null,
      evidenceId: row.evidenceId,
      id: row.id,
      kind: row.kind,
      parentCommentId: row.parentCommentId,
      reactions: [...(reactionsByComment.get(row.id)?.values() ?? [])],
      rect: row.anchorRect,
      time: timeOf(row),
      resolvedAt: row.resolvedAt,
      resolvedByUserId: row.resolvedByUserId,
      source: sourceOf(row),
      updatedAt: row.updatedAt,
    }));
};

const requireComment = async (
  ctx: {
    acceptanceCommentModel: AcceptanceCommentModel;
    serverDB: LobeChatDatabase;
    userId: string;
  },
  id: string,
) => {
  const comment = await ctx.acceptanceCommentModel.findById(id);
  if (!comment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
  const access = await resolveAcceptanceCommentAccess(
    ctx.serverDB,
    ctx.userId,
    comment.acceptanceId,
  );
  if (!access.canComment) throw new TRPCError({ code: 'FORBIDDEN', message: 'Read-only access' });
  return { access, comment };
};

/**
 * A comment may only speak as an agent the caller is actually allowed to use.
 *
 * `author_agent_id` decides whose name, title and avatar the discussion shows,
 * and a public acceptance shows it to anyone with the link. Without this gate a
 * participant could name any agent id that exists and impersonate it.
 *
 * The scope is the acceptance's workspace ONLY for callers who belong to it.
 * The workspace scope answers "is this agent visible in that workspace", not
 * "may this caller use it", so handing it to a visitor who merely opened a
 * public link would let them post under any agent of that workspace — and the
 * discussion payload hands them the ids to pick from. A visitor falls back to
 * personal scope, where they can only sign as their own agents.
 */
const assertAuthorAgentUsable = async (
  db: LobeChatDatabase,
  ctx: { userId: string; workspaceId?: string },
  agentId?: string,
) => {
  if (!agentId) return;
  try {
    await assertAgentUsableBy(db, agentId, ctx);
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND')
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Author agent not found' });
    throw error;
  }
};

/**
 * A comment may only point at a round or an evidence tile of its own acceptance.
 *
 * The foreign keys prove these ids exist somewhere in the database; they say
 * nothing about which acceptance they hang off. Access is checked against
 * `acceptanceId` alone, so an unscoped reference would let a participant pull a
 * round index or an evidence anchor out of an acceptance they cannot read.
 */
const assertReferencesBelongToAcceptance = async (
  db: LobeChatDatabase,
  acceptanceId: string,
  refs: {
    anchor?: { evidenceId: string; checkItemId: string; time?: { start: number } };
    runId?: string;
  },
) => {
  if (refs.runId) {
    const [run] = await db
      .select({ id: verifyRuns.id })
      .from(verifyRuns)
      .where(and(eq(verifyRuns.id, refs.runId), eq(verifyRuns.acceptanceId, acceptanceId)))
      .limit(1);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found' });
  }

  if (refs.anchor) {
    const [evidence] = await db
      .select({
        id: verifyEvidence.id,
        type: verifyEvidence.type,
        checkItemId: verifyCheckResults.checkItemId,
        sourceCriterionId: verifyCheckResults.sourceCriterionId,
        runId: verifyRuns.id,
        plan: verifyRuns.plan,
      })
      .from(verifyEvidence)
      .innerJoin(verifyCheckResults, eq(verifyCheckResults.id, verifyEvidence.checkResultId))
      .innerJoin(verifyRuns, eq(verifyRuns.id, verifyCheckResults.verifyRunId))
      .where(
        and(
          eq(verifyEvidence.id, refs.anchor.evidenceId),
          eq(verifyRuns.acceptanceId, acceptanceId),
        ),
      )
      .limit(1);
    if (!evidence) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evidence not found' });
    // Use the producing round's snapshot, even when the viewer is in a later round.
    // Flow occurrences may share a criterion but remain distinct checks in the union.
    const item = evidence.plan?.find((item) => item.id === evidence.checkItemId);
    const checkId = item?.sourceFlowNode
      ? item.id
      : (item?.sourceCriterionId ?? evidence.sourceCriterionId ?? evidence.checkItemId);
    if (checkId !== refs.anchor.checkItemId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Evidence belongs to another check' });
    if (!['screenshot', 'gif', 'video'].includes(evidence.type))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This evidence cannot carry a media anchor',
      });
    if (Boolean(refs.anchor.time) !== (evidence.type === 'video'))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Video anchors require a time; images have no time',
      });
    return evidence.runId;
  }
};

/**
 * What a visitor may land on one acceptance in one minute. The discussion is
 * open to whoever holds the link, so the cost of flooding it has to sit
 * somewhere; a reader answering evidence writes a handful of remarks, and a
 * flood writes hundreds. Reviewers are exempt — the round-publishing tools post
 * on their behalf in bursts.
 *
 * A retry of a remark that already landed is not a new remark: the ceiling is
 * charged where the row is written, so an idempotent replay of the tenth one
 * still answers with that row instead of a refusal.
 */
const VISITOR_COMMENT_WINDOW_MS = 60_000;
const VISITOR_COMMENTS_PER_WINDOW = 10;

/**
 * Which answers a decider may give from which state. A grant is taken back,
 * never declined after the fact; a closed request is asked again, not reopened.
 */
const ACCESS_TRANSITIONS: Record<
  'decline' | 'grant' | 'revoke',
  { from: AcceptanceAccessRequestStatus; to: AcceptanceAccessRequestStatus }
> = {
  decline: { from: 'pending', to: 'declined' },
  grant: { from: 'pending', to: 'granted' },
  revoke: { from: 'granted', to: 'revoked' },
};

export const acceptanceCommentRouter = router({
  create: writeProcedure.input(createSchema).mutation(async ({ ctx, input }) => {
    const access = await resolveAcceptanceCommentAccess(
      ctx.serverDB,
      ctx.userId,
      input.acceptanceId,
    );
    if (!access.canComment) throw new TRPCError({ code: 'FORBIDDEN', message: 'Read-only access' });
    // An approval and a round introduction are the delivery speaking, not a
    // reader answering it: a visitor holding the public link writes remarks.
    if ((input.kind === 'approval' || input.kind === 'proposal') && !access.canApprove)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a reviewer of this acceptance' });

    await assertAuthorAgentUsable(
      ctx.serverDB,
      { userId: ctx.userId, workspaceId: access.memberOfWorkspaceId },
      input.authorAgentId,
    );
    const evidenceRunId = await assertReferencesBelongToAcceptance(
      ctx.serverDB,
      access.acceptance.id,
      {
        anchor: input.anchor,
        runId: input.contextRunId,
      },
    );

    try {
      const { comment } = await ctx.acceptanceCommentModel.create({
        acceptanceId: access.acceptance.id,
        anchor: input.anchor,
        attachments: input.attachments,
        authorAgentId: input.authorAgentId,
        authorUserId: ctx.userId,
        clientId: input.clientId,
        content: input.content,
        // Inherited evidence keeps its producing run; the comment belongs to the viewing run.
        contextRunId: input.contextRunId ?? evidenceRunId,
        editorData: input.editorData as never,
        kind: input.kind,
        parentCommentId: input.parentCommentId,
        source: input.source,
        /*
         * The ceiling travels INTO the write so it is counted and charged in
         * one transaction: checked out here it would be advisory only, and a
         * burst of parallel requests would each read the same under-limit
         * count. Reactions take another path, and each (comment, emoji) pair is
         * one idempotent row per person anyway.
         */
        rateLimit: access.canApprove
          ? undefined
          : {
              max: VISITOR_COMMENTS_PER_WINDOW,
              since: new Date(Date.now() - VISITOR_COMMENT_WINDOW_MS),
            },
        workspaceId: access.acceptance.workspaceId,
      });
      const [item] = await enrich(ctx.serverDB, [comment], {
        canModerate: access.canApprove,
        ownerUserId: access.acceptance.userId,
        userId: ctx.userId,
        visibility: access.acceptance.visibility,
        workspaceId: access.acceptance.workspaceId,
      });
      notifyAcceptance(access.acceptance.id, 'comments', ctx.userId);
      return { data: item, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      if (error instanceof Error && error.message === ACCEPTANCE_COMMENT_PARENT_NOT_FOUND)
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      if (error instanceof Error && error.message === ACCEPTANCE_COMMENT_RATE_LIMITED)
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many comments on this acceptance, try again in a minute',
        });
      console.error('[acceptanceComment:create]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create comment',
      });
    }
  }),

  /**
   * Ask the acceptance's deciders for edit-collaboration: the right to send the
   * delivery back, and to talk to the agent bound to it. Open to anyone who may
   * remark here — a visitor on a public link included — because nothing moves
   * until a decider says yes, and a remark alone never reaches the agent.
   *
   * It lands as a discussion turn the deciders answer in place. One standing
   * request per person: a pending or granted one is handed back rather than
   * duplicated, and a declined or revoked one may be asked again.
   */
  requestAccess: writeProcedure
    .input(
      z.object({
        acceptanceId: z.string().min(1),
        clientId: z.string().trim().min(1).max(255),
        content: z.string().trim().max(2000).optional(),
        contextRunId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAcceptanceCommentAccess(
        ctx.serverDB,
        ctx.userId,
        input.acceptanceId,
      );
      if (!access.canComment)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Read-only access' });
      // A gate's revision is the goal's own call, carried out by its main Agent.
      if (access.acceptance.subjectType === 'goal_gate')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A goal gate cannot hand out reject access',
        });
      // The owner already holds everything a grant hands out. A workspace
      // member who may decide still cannot talk to the owner's agent, so they
      // may ask like anyone else.
      if (access.isOwner)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You already own this acceptance',
        });
      await assertReferencesBelongToAcceptance(ctx.serverDB, access.acceptance.id, {
        runId: input.contextRunId,
      });

      const enrichScope = {
        canModerate: access.canApprove,
        ownerUserId: access.acceptance.userId,
        userId: ctx.userId,
        visibility: access.acceptance.visibility,
        workspaceId: access.acceptance.workspaceId,
      };
      const accessRequest: AcceptanceAccessRequest = {
        permission: 'collaborate',
        status: 'pending',
      };
      try {
        // A pending or granted request already standing comes back as the
        // duplicate — decided inside the write's own transaction, so two
        // submissions at once still leave a single standing request.
        const { comment, isDuplicate } = await ctx.acceptanceCommentModel.create({
          acceptanceId: access.acceptance.id,
          authorUserId: ctx.userId,
          clientId: input.clientId,
          content: input.content ?? '',
          contextRunId: input.contextRunId,
          kind: 'access_request',
          metadata: { accessRequest },
          rateLimit: access.canApprove
            ? undefined
            : {
                max: VISITOR_COMMENTS_PER_WINDOW,
                since: new Date(Date.now() - VISITOR_COMMENT_WINDOW_MS),
              },
          workspaceId: access.acceptance.workspaceId,
        });
        const [item] = await enrich(ctx.serverDB, [comment], enrichScope);
        if (!isDuplicate) notifyAcceptance(access.acceptance.id, 'comments', ctx.userId);
        return { data: item, success: true };
      } catch (error) {
        if (error instanceof Error && error.message === ACCEPTANCE_COMMENT_RATE_LIMITED)
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many comments on this acceptance, try again in a minute',
          });
        throw error;
      }
    }),

  /**
   * A decider's answer to an access request: grant it, decline it, or take a
   * grant back. Deciding who may send a delivery back is itself a decision on
   * it, so it takes the same right the reject does.
   */
  answerAccessRequest: writeProcedure
    .input(
      z.object({
        decision: z.enum(['decline', 'grant', 'revoke']),
        id: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { access, comment } = await requireComment(ctx, input.id);
      if (comment.kind !== 'access_request' || comment.deletedAt)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Access request not found' });
      if (!(await canManageAcceptance(ctx, access.acceptance)))
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator or a workspace member with edit access can answer this',
        });

      const transition = ACCESS_TRANSITIONS[input.decision];
      const current = comment.metadata?.accessRequest;
      if (current?.status !== transition.from)
        throw new TRPCError({
          code: 'CONFLICT',
          message: `This request is already ${current?.status ?? 'closed'}`,
        });

      const row = await ctx.acceptanceCommentModel.answerAccessRequest(
        comment.id,
        transition.from,
        {
          ...current,
          decidedAt: new Date().toISOString(),
          decidedByUserId: ctx.userId,
          status: transition.to,
        },
      );
      if (!row)
        throw new TRPCError({ code: 'CONFLICT', message: 'This request was answered meanwhile' });

      const [item] = await enrich(ctx.serverDB, [row], {
        canModerate: access.canApprove,
        ownerUserId: access.acceptance.userId,
        userId: ctx.userId,
        visibility: access.acceptance.visibility,
        workspaceId: access.acceptance.workspaceId,
      });
      // The requester's page holds its decision controls in the bundle, so it
      // has to hear about this as a session change, not only a new remark.
      notifyAcceptance(comment.acceptanceId, 'comments', ctx.userId);
      notifyAcceptance(comment.acceptanceId, 'session', ctx.userId);
      return { data: item, success: true };
    }),

  /**
   * Take a remark down. Its author always may; the acceptance's reviewers may
   * take down anyone's, because the discussion is open to whoever holds the
   * link and the author of an unwanted remark is exactly who will not remove
   * it. The row becomes the same tombstone either way.
   */
  delete: writeProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { access, comment } = await requireComment(ctx, input.id);
      const own = comment.authorUserId === ctx.userId;
      if (!own && !access.canApprove)
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the author or a reviewer of this acceptance may delete',
        });
      const result = await ctx.acceptanceCommentModel.delete(
        comment.id,
        own ? { authorUserId: ctx.userId } : { moderator: true },
      );
      notifyAcceptance(comment.acceptanceId, 'comments', ctx.userId);
      // Withdrawing an access request gives back whatever it was granted.
      if (comment.kind === 'access_request')
        notifyAcceptance(comment.acceptanceId, 'session', ctx.userId);
      return { data: { deleted: result !== false }, success: true };
    }),

  list: readProcedure
    .input(z.object({ acceptanceId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<AcceptanceCommentList> => {
      const access = await resolveAcceptanceCommentAccess(
        ctx.serverDB,
        ctx.userId,
        input.acceptanceId,
      );
      const rows = await ctx.acceptanceCommentModel.listByAcceptance(access.acceptance.id);
      const items = await enrich(ctx.serverDB, rows, {
        canModerate: access.canApprove,
        ownerUserId: access.acceptance.userId,
        userId: ctx.userId,
        visibility: access.acceptance.visibility,
        workspaceId: access.acceptance.workspaceId,
      });
      return {
        canApprove: access.canApprove,
        canComment: access.canComment,
        canManageAccess: await canManageAcceptance(ctx, access.acceptance),
        items,
      };
    }),

  /**
   * Toggle the caller's own emoji on one comment. Idempotent both ways: the
   * key is derived from (comment, emoji), so a double-click adds nothing and a
   * second removal deletes nothing.
   */
  react: writeProcedure
    .input(
      z.object({
        emoji: z.string().trim().min(1).max(16),
        id: z.string().min(1),
        on: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { access, comment } = await requireComment(ctx, input.id);
      if (comment.kind === 'reaction')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot react to a reaction' });

      if (!input.on) {
        await ctx.acceptanceCommentModel.removeReaction({
          acceptanceId: comment.acceptanceId,
          authorUserId: ctx.userId,
          commentId: comment.id,
          emoji: input.emoji,
        });
        return { data: { on: false }, success: true };
      }

      await ctx.acceptanceCommentModel.create({
        acceptanceId: comment.acceptanceId,
        authorUserId: ctx.userId,
        clientId: acceptanceReactionClientId(comment.id, input.emoji),
        content: input.emoji,
        kind: 'reaction',
        parentCommentId: comment.id,
        workspaceId: access.acceptance.workspaceId,
      });
      return { data: { on: true }, success: true };
    }),

  setResolved: writeProcedure
    .input(z.object({ id: z.string().min(1), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { access, comment } = await requireComment(ctx, input.id);
      if (comment.parentCommentId)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a thread root can be resolved' });
      // Closing a thread is a verdict on it. Whoever opened it may close their
      // own; everyone else's is the reviewers' call, not any reader's.
      if (!access.canApprove && comment.authorUserId !== ctx.userId)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a reviewer of this acceptance' });
      const row = await ctx.acceptanceCommentModel.setResolved(
        comment.id,
        input.resolved,
        ctx.userId,
      );
      notifyAcceptance(comment.acceptanceId, 'comments', ctx.userId);
      return { data: { resolvedAt: row?.resolvedAt ?? null }, success: true };
    }),
});
