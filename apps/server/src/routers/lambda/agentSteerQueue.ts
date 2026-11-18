import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import {
  listFollowUps,
  queueFollowUp,
  removeFollowUp,
} from '@/server/services/aiAgent/steerQueue/followUps';
import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

import { ExecAgentFieldsSchema, foldLegacyUserMessageFields } from './aiAgent/execSchemas';
import { assertCanUseAgentRunConversation } from './aiAgent/guards';
import { acceptsFileWorksOf, acceptsMemberRuntimeEndOf } from './aiAgent/utils';

/**
 * A composer send queued behind the running turn: the fresh-send part of an
 * `aiAgent.execAgent` request. Resume / regenerate / supersede fields are not
 * accepted — a follow-up always starts a new turn of its own. `sourceOperationId`
 * is accepted — another agent queueing through `lh topic send` — but resolved
 * into the sender right away and never stored.
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
  requireDevice: true,
  steer: true,
  supersedeLiveRun: true,
  title: true,
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
    const { sourceOperationId, streamFeatures, ...request } = input.request;
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
    return queueFollowUp(
      { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
      {
        audit: { clientIp: ctx.clientIp ?? undefined, userAgent: ctx.userAgent ?? undefined },
        composer: storedComposer(input.composer),
        id: input.id,
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
        scope,
        sourceOperationId,
      },
    );
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

    return listFollowUps(toScope(input, ctx.userId));
  }),

  /**
   * Withdraw a queued follow-up, in one step with reading where it is:
   * `removed`, or why not — `delivering` (a run took it and has not settled;
   * it may still come back), `taken` (delivered) or `absent` (never stored).
   * The queue is the caller's own, so only their follow-ups can be withdrawn.
   */
  remove: steerQueueWriteProcedure
    .input(ScopeSchema.extend({ id: z.string() }))
    .mutation(({ input, ctx }) => removeFollowUp(toScope(input, ctx.userId), input.id)),
});
