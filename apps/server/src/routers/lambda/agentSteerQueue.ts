import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import type { QueuedFollowUp } from '@/server/services/aiAgent/steerQueue';
import { findOwnLiveRuns, isRunAlive } from '@/server/services/aiAgent/steerQueue/liveRuns';
import { redisService } from '@/server/services/redis';
import {
  type SteerQueueScope,
  SteerQueueWriteUnknownError,
} from '@/server/services/redis/steerQueue';

import { ExecAgentFieldsSchema, foldLegacyUserMessageFields } from './aiAgent/execSchemas';
import { assertCanUseAgentRunConversation } from './aiAgent/guards';
import { acceptsFileWorksOf, acceptsMemberRuntimeEndOf } from './aiAgent/utils';

const log = debug('lobe-lambda-router:agent-steer-queue');

/**
 * A composer send queued behind the running turn: the fresh-send part of an
 * `aiAgent.execAgent` request. Resume / regenerate / supersede fields are not
 * accepted — a follow-up always starts a new turn of its own.
 */
const QueuedRequestSchema = ExecAgentFieldsSchema.omit({
  autoStart: true,
  clientOperations: true,
  existingMessageIds: true,
  includeFinalState: true,
  parentMessageId: true,
  replacesOperationId: true,
  resumeApproval: true,
  resumeApprovals: true,
  resumeToolResult: true,
  sourceOperationId: true,
  steer: true,
}).refine((data) => data.agentId || data.slug, {
  message: 'Either agentId or slug must be provided',
});

const ScopeSchema = z.object({
  threadId: z.string().nullish(),
  topicId: z.string(),
});

const AppendSchema = z.object({
  /** Client-minted entry id, so the client can match its optimistic tray item. */
  // Stored in a tab / newline delimited header, so only delimiter-safe ids.
  id: z
    .string()
    .regex(/^[\w-]{1,64}$/, 'Use letters, digits, `_` or `-` (at most 64)')
    .optional(),
  /**
   * The composer state the follow-up was sent from, stored opaquely so a
   * reloaded client can show and resend it as typed. Dropped above the cap.
   */
  composer: z
    .object({
      editorData: z.record(z.string(), z.unknown()).optional(),
      /** Attachment previews (id, name, type, url) the tray and Edit rebuild uploads from. */
      filesPreview: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
    })
    .optional(),
  request: QueuedRequestSchema,
});

/**
 * Composer state kept with an entry. Each part has its own cap, so a long
 * editor document never costs the attachment previews, nor the reverse.
 */
const MAX_EDITOR_DATA_BYTES = 32 * 1024;
const MAX_FILES_PREVIEW_BYTES = 16 * 1024;
const within = (value: unknown, bytes: number) =>
  value !== undefined && JSON.stringify(value).length <= bytes;
const storedComposer = (composer: z.infer<typeof AppendSchema>['composer']) => {
  if (!composer) return;
  const editorData = within(composer.editorData, MAX_EDITOR_DATA_BYTES)
    ? composer.editorData
    : undefined;
  const filesPreview = within(composer.filesPreview, MAX_FILES_PREVIEW_BYTES)
    ? composer.filesPreview
    : undefined;
  return editorData || filesPreview ? { editorData, filesPreview } : undefined;
};

const steerQueueProcedure = wsCompatProcedure.use(serverDatabase);
const steerQueueWriteProcedure = steerQueueProcedure.use(withScopedPermission('message:create'));

/** The caller's own queue on the surface: each user only reads and fills theirs. */
const toScope = (scope: z.infer<typeof ScopeSchema>, userId: string): SteerQueueScope => ({
  threadId: scope.threadId ?? null,
  topicId: scope.topicId,
  userId,
});

/**
 * Follow-ups queued behind a running agent turn ("steer"), held server-side.
 * The runtime hands the turn back at its next decision point and starts the
 * queued follow-ups as the next turn itself — see `startQueuedFollowUp`.
 */
export const agentSteerQueueRouter = router({
  /**
   * Queue a follow-up behind the topic's running turn.
   *
   * `queued: false` means nothing was stored and the client should send the
   * message itself: no own run is live (`idle`), the queue is at its bound
   * (`full`), or the follow-up could not be stored (`unavailable`). A `SERVICE_UNAVAILABLE`
   * error means the outcome is unknown: retry with the same `id`.
   */
  append: steerQueueWriteProcedure.input(AppendSchema).mutation(async ({ input, ctx }) => {
    const { streamFeatures, ...request } = input.request;
    const topicId = request.appContext?.topicId;
    if (!topicId) return { queued: false as const, reason: 'idle' as const };

    await assertCanUseWorkspaceAgent({
      agentId: request.agentId,
      db: ctx.serverDB,
      groupId: request.appContext?.groupId,
      slug: request.slug,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    await assertCanUseAgentRunConversation({
      db: ctx.serverDB,
      topicId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });

    const scope = toScope({ threadId: request.appContext?.threadId, topicId }, ctx.userId);
    // A retry of an append whose answer was lost: what the server already holds
    // decides, before liveness — the run may have ended since, but the entry is
    // still delivered (or was), so the client must never send it too.
    if (input.id) {
      const state = await redisService.steerQueue.entryState(scope, input.id);
      // Redis cannot be read: an earlier try may be stored, and the run may
      // have ended since — neither "queued" nor "send directly".
      if (!state)
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Queue unavailable' });
      if (state === 'queued')
        return { id: input.id, length: 1, queued: true as const, state: 'queued' as const };
      if (state === 'delivering' || state === 'taken')
        return { id: input.id, length: 0, queued: true as const, state };
    }
    const liveRuns = await findOwnLiveRuns(
      { db: ctx.serverDB, workspaceId: ctx.workspaceId },
      scope,
    );
    if (liveRuns.length === 0) return { queued: false as const, reason: 'idle' as const };
    // More than one run can look live: a finished run keeps its row `running`
    // until its last step commits, and thread starts are not serialized. The
    // user types behind the newest one (the list is newest first); an older
    // run that ends later leaves entries bound to a live run alone.
    const [behindOperationId] = liveRuns;

    const entry: QueuedFollowUp = {
      audit: { clientIp: ctx.clientIp ?? undefined, userAgent: ctx.userAgent ?? undefined },
      composer: storedComposer(input.composer),
      createdAt: Date.now(),
      id: input.id ?? randomUUID(),
      request: {
        // A client from before `userMessage` sends the top-level selection fields.
        ...foldLegacyUserMessageFields(request),
        acceptsFileWorks: acceptsFileWorksOf(streamFeatures),
        acceptsMemberRuntimeEnd: acceptsMemberRuntimeEndOf(streamFeatures),
        // A follow-up continues the conversation it was typed into; it never
        // branches or creates one.
        appContext: {
          ...request.appContext,
          initialTopicMetadata: undefined,
          newThread: undefined,
          projectWorkingDirectoryId: undefined,
        },
      },
      userId: ctx.userId,
    };

    let length: Awaited<ReturnType<typeof redisService.steerQueue.append>>;
    try {
      length = await redisService.steerQueue.append(scope, entry, behindOperationId);
    } catch (error) {
      if (!(error instanceof SteerQueueWriteUnknownError)) throw error;
      // Neither "queued" nor "send directly" is safe to answer; the client
      // retries with the same entry id, which appends at most once.
      throw new TRPCError({ cause: error, code: 'SERVICE_UNAVAILABLE', message: error.message });
    }
    // Taken back after its command failed: definitely not stored.
    if (length === 'notStored') return { queued: false as const, reason: 'unavailable' as const };
    // Redis is a deployment requirement, so no client is an outage: an earlier
    // try of this id may have been stored. Unknown — the client keeps it the
    // server's and retries the same id.
    if (length === undefined)
      throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Queue unavailable' });
    if (length === 'full') return { queued: false as const, reason: 'full' as const };
    // A retry of a write that landed and was already taken by its run: it is
    // on its way, so the client must not send it again.
    if (length === 'taken')
      return { id: entry.id, length: 0, queued: true as const, state: 'taken' as const };

    // The run may have ended between the check above and the append, after its
    // drain: then nothing would ever start this entry. Take it back and let the
    // client send it. If the take-back loses, a drain already started it.
    if (
      !(await isRunAlive(
        { db: ctx.serverDB, workspaceId: ctx.workspaceId },
        ctx.userId,
        behindOperationId,
      ))
    ) {
      const removed = await redisService.steerQueue.remove(scope, entry.id);
      if (removed) return { queued: false as const, reason: 'idle' as const };
    }

    log('append: topic=%s thread=%s id=%s length=%d', topicId, scope.threadId, entry.id, length);
    return { id: entry.id, length, queued: true as const, state: 'queued' as const };
  }),

  /**
   * The follow-ups on a conversation that are not delivered yet, oldest first.
   * `delivering` ones were taken by a run that has not confirmed them: they
   * cannot be withdrawn, and come back as waiting should the delivery fail.
   */
  list: steerQueueProcedure.input(ScopeSchema).query(async ({ input, ctx }) => {
    await assertCanUseAgentRunConversation({
      db: ctx.serverDB,
      topicId: input.topicId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });

    const scope = toScope(input, ctx.userId);
    let snapshot: { delivering: QueuedFollowUp[]; waiting: QueuedFollowUp[] };
    try {
      snapshot = await redisService.steerQueue.snapshot<QueuedFollowUp>(scope);
    } catch (error) {
      // Unknown, not empty: a client must keep what it shows as queued.
      throw new TRPCError({
        cause: error,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Queue unavailable',
      });
    }
    const { delivering, waiting } = snapshot;
    const own = (entry: QueuedFollowUp) => entry.userId === ctx.userId;
    const waitingIds = new Set(waiting.map((entry) => entry.id));
    return [
      ...waiting.filter(own).map((entry) => ({ entry, delivering: false })),
      // An entry returned to the queue mid-read is listed once, as waiting.
      ...delivering
        .filter((entry) => own(entry) && !waitingIds.has(entry.id))
        .map((entry) => ({ entry, delivering: true })),
    ]
      .sort((a, b) => a.entry.createdAt - b.entry.createdAt)
      .map(({ entry, delivering: isDelivering }) => ({
        createdAt: entry.createdAt,
        delivering: isDelivering,
        editorData: entry.composer?.editorData,
        fileIds: entry.request.fileIds,
        filesPreview: entry.composer?.filesPreview,
        id: entry.id,
        mentionedAgents: entry.request.mentionedAgents,
        prompt: entry.request.prompt,
        selectedSkillIds: entry.request.selectedSkillIds,
        selectedToolIds: entry.request.selectedToolIds,
      }));
  }),

  /**
   * Withdraw a queued follow-up, in one step with reading where it is:
   * `removed`, or why not — `delivering` (a run took it and has not settled;
   * it may still come back), `taken` (delivered) or `absent` (never stored).
   * The queue is the caller's own, so only their follow-ups can be withdrawn.
   */
  remove: steerQueueWriteProcedure
    .input(ScopeSchema.extend({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const state = await redisService.steerQueue.entryState(toScope(input, ctx.userId), input.id, {
        remove: true,
      });
      // Without Redis nothing is known: it may still be delivered, so it must
      // neither read as withdrawn nor be resent.
      if (!state)
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'Queue unavailable' });
      return { removed: state === 'removed', state };
    }),
});
