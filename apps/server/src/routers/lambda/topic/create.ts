import {
  chatTopicCreateMetadataSchema,
  type HeteroSessionImportPayload,
  heteroSessionImportPayloadSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { ProjectModel } from '@/database/models/project';
import { ProjectWorkingDirectoryModel } from '@/database/models/projectWorkingDirectory';
import { router } from '@/libs/trpc/lambda';
import { type BatchTaskResult } from '@/types/service';

import {
  assertCanUseConversationTargets,
  assertCanUseTopicTargets,
} from '../_helpers/conversationResourceGuard';
import { resolveContextWithAgentId } from '../_helpers/resolveContext';
import {
  assertCreatorMessageTargets,
  assertCreatorTopicTargets,
} from '../_helpers/shareVisitorTargetGuard';
import { basicContextSchema } from '../_schema/context';
import { guardCtx, topicProcedure } from './procedures';

// Each batch item resolves its agent/session through the DB; cap the fan-out
// so a large client-supplied batch does not burst concurrent lookups.
const BATCH_CREATE_CONTEXT_RESOLUTION_CONCURRENCY = 5;

export const createRouter = router({
  batchCreateTopics: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.array(
        z
          .object({
            favorite: z.boolean().optional(),
            id: z.string().optional(),
            messages: z.array(z.string()).optional(),
            title: z.string(),
          })
          .extend(basicContextSchema.shape),
      ),
    )
    .mutation(async ({ input, ctx }): Promise<BatchTaskResult> => {
      // Resolve both directions before authorization: legacy callers may send
      // only sessionId, while the ACL is attached to the owning agent.
      const resolvedTopics = await pMap(
        input,
        async (item) => {
          const { agentId, ...rest } = item;
          const resolved = await resolveContextWithAgentId(
            { agentId, groupId: rest.groupId, sessionId: rest.sessionId },
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );
          return { ...rest, agentId: resolved.agentId, sessionId: resolved.sessionId };
        },
        { concurrency: BATCH_CREATE_CONTEXT_RESOLUTION_CONCURRENCY },
      );

      await assertCanUseConversationTargets(
        guardCtx(ctx),
        resolvedTopics.map((item) => ({ agentId: item.agentId, groupId: item.groupId })),
      );
      // `messages` are REPARENTED onto the new topic by ownership only. A
      // visitor message (creator-owned row under a `senderId` topic) moved to
      // a creator topic would escape `notShareVisitorMessage()` for good.
      await assertCreatorMessageTargets(
        guardCtx(ctx),
        resolvedTopics.flatMap((item) => item.messages ?? []),
      );

      const data = await ctx.topicRepo.batchCreate(resolvedTopics as any);

      return { added: data.length, ids: [], skips: [], success: true };
    }),
  cloneTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(z.object({ id: z.string(), newTitle: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      // Duplicating a visitor topic would copy its content into creator scope
      // (see `assertCreatorTopicTargets` on `batchMoveTopics` above).
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);
      const data = await ctx.topicRepo.duplicate(input.id, input.newTitle);

      return data.topic.id;
    }),
  /**
   * Fork a topic from one of its messages: copy the conversation prefix
   * (first message → `messageId`) into a brand new topic and return its id.
   *
   * Shares `cloneTopic`'s guards: a fork writes a new topic and copies content
   * out of the source, so it needs the same `topic:create` capability and the
   * same refusal to lift a visitor topic's content into creator scope.
   */
  forkTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        id: z.string(),
        messageId: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseTopicTargets(guardCtx(ctx), [input.id]);
      await assertCreatorTopicTargets(guardCtx(ctx), [input.id]);
      const data = await ctx.topicRepo.duplicate(input.id, input.newTitle, {
        upToMessageId: input.messageId,
      });

      return data.topic.id;
    }),
  /**
   * Edit-and-resend for runtimes whose native history cannot be rewound
   * (Codex): copies the conversation up to one user message into a new topic
   * with the edited content. The source topic is left as it was.
   */
  branchTopicAtMessage: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        content: z.string(),
        editorData: z.record(z.string(), z.any()).nullish(),
        messageId: z.string(),
        title: z.string().optional(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { topicId, messageId, ...edit } = input;
      await assertCanUseTopicTargets(guardCtx(ctx), [topicId]);
      // Same visitor guard as `cloneTopic` above.
      await assertCreatorTopicTargets(guardCtx(ctx), [topicId]);
      const branch = await ctx.topicRepo.branchAtMessage(topicId, messageId, edit);
      if (!branch) throw new TRPCError({ code: 'NOT_FOUND', message: 'User message not found' });

      return { messageId: branch.messageId, topicId: branch.topic.id };
    }),
  createTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z
        .object({
          favorite: z.boolean().optional(),
          groupId: z.string().nullish(),
          messages: z.array(z.string()).optional(),
          // The pinned reasoning snapshot taken next to the pinned model
          // (`snapshotAgentReasoning`); other metadata keys are server-owned.
          metadata: chatTopicCreateMetadataSchema.optional(),
          // The topic's pinned model snapshot, persisted to the top-level
          // `topics.model`/`provider` columns (config source of truth).
          model: z.string().optional(),
          // Bind the new row to a project, conversation-only — a project "+"
          // with no directory the agent can run in. A directory wins.
          projectId: z.string().optional(),
          // Bind the new row to a project working directory. Resolved and
          // pinned below, mirroring `projectWorkingDirectory.startTopic`.
          projectWorkingDirectoryId: z.string().optional(),
          provider: z.string().optional(),
          title: z.string(),
          trigger: z.string().optional(),
        })
        .extend(basicContextSchema.shape),
    )
    .mutation(async ({ input, ctx }) => {
      const { agentId, projectId, projectWorkingDirectoryId, ...rest } = input;
      const resolved = await resolveContextWithAgentId(
        { agentId, groupId: rest.groupId, sessionId: rest.sessionId },
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      await assertCanUseConversationTargets(guardCtx(ctx), [
        { agentId: resolved.agentId, groupId: rest.groupId },
      ]);
      // See batchCreateTopics — reparenting a visitor message would leak it.
      await assertCreatorMessageTargets(guardCtx(ctx), rest.messages ?? []);

      // A topic started from a project group's "+" defers its row to the first
      // message. Pin the directory here so the row is born inside the project —
      // list, sidebar group and execution routing — instead of dropping into a
      // path-only conversation. A directory that can no longer be resolved
      // (deleted, unlinked from its environment, or another user's) is logged
      // and skipped: losing the binding must not fail the user's first send.
      const directory = projectWorkingDirectoryId
        ? await new ProjectWorkingDirectoryModel(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          )
            .resolve(projectWorkingDirectoryId)
            .catch((error) => {
              console.error(
                '[topic.createTopic] Failed to resolve the project directory binding:',
                error,
              );
              return undefined;
            })
        : undefined;

      // Read access is enough: everyone who can read a project collaborates in it.
      if (
        !directory &&
        projectId &&
        !(await new ProjectModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined).findById(
          projectId,
        ))
      )
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

      const data = await ctx.topicRepo.create({
        ...rest,
        ...(!directory && projectId && { projectId }),
        agentId: resolved.agentId,
        sessionId: resolved.sessionId,
        ...(directory
          ? {
              metadata: {
                ...rest.metadata,
                boundDeviceId: directory.deviceId,
                workingDirectory: directory.path,
                workingDirectoryConfig: { path: directory.path },
              },
              projectId: directory.projectId,
              projectWorkingDirectoryId: directory.id,
            }
          : {}),
      });

      return data.id;
    }),
  importTopic: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        agentId: z.string(),
        data: z.string(),
        groupId: z.string().nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseConversationTargets(guardCtx(ctx), [
        { agentId: input.agentId, groupId: input.groupId },
      ]);

      const result = await ctx.topicImporterRepo.importTopic({
        agentId: input.agentId,
        data: input.data,
        groupId: input.groupId,
      });

      return result;
    }),
  importHeteroSessions: topicProcedure
    .use(withScopedPermission('topic:create'))
    .input(
      z.object({
        agentId: z.string(),
        groupId: z.string().nullish(),
        sessions: z.array(heteroSessionImportPayloadSchema),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanUseConversationTargets(guardCtx(ctx), [
        { agentId: input.agentId, groupId: input.groupId },
      ]);

      return ctx.heteroSessionImporterRepo.importSessions({
        agentId: input.agentId,
        groupId: input.groupId,
        sessions: input.sessions as HeteroSessionImportPayload[],
      });
    }),
  getHeteroSessionImportStatus: topicProcedure.query(async ({ ctx }) => {
    return ctx.heteroSessionImporterRepo.getImportStatus();
  }),
});
