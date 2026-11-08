import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import { resolveAgentInterventionBySource } from '@/business/server/agent-run/agentInterventionReview';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { AiAgentService } from '@/server/services/aiAgent';

import { mapAgentInterventionTRPCError } from '../_helpers/agentInterventionError';
import { toClientExecAgentResult } from '../_helpers/groupMemberContinuationResult';
import { ResolveAgentInterventionBySourceSchema } from '../_schema/agentIntervention';
import { dispatchClaimedAgentIntervention } from '../aiAgent';
import {
  findVisitorTopicOrThrow,
  resolveLinkShareOrThrow,
  toVisitorSafeStartupError,
} from './guards';
import { shareChatProcedure, ShareTopicScopeSchema } from './procedures';
import { createShareRunScope } from './runScope';

const log = debug('lobe-server:router:shareChat');

/**
 * Authorize a visitor to act on a share run. It is not enough that the topic
 * belongs to this visitor: `operationId` must also match the operation
 * CURRENTLY recorded as running on that topic. Without that check a visitor
 * could pass an arbitrary operationId (topics/operations are creator-owned
 * rows) and reach an unrelated run on the creator's account.
 *
 * Returns the creator-scoped service, same as `execAgent`: the run's operation
 * / thread rows were written under the creator's identity.
 */
const authorizeVisitorRunningOperation = async (
  db: LobeChatDatabase,
  visitorUserId: string,
  input: { operationId: string; shareId: string; topicId: string },
) => {
  const share = await resolveLinkShareOrThrow(db, input.shareId, visitorUserId);

  const topicModel = new TopicModel(db, share.ownerId, share.workspaceId ?? undefined, undefined, {
    includeShareVisitor: true,
  });
  const topic = await findVisitorTopicOrThrow(topicModel, {
    agentId: share.agentId,
    topicId: input.topicId,
    visitorUserId,
  });

  const runningOperationId = topic.metadata?.runningOperation?.operationId;
  if (!runningOperationId || runningOperationId !== input.operationId) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'No matching running operation found on this topic',
    });
  }

  const aiAgentService = new AiAgentService(db, share.ownerId, {
    includeShareVisitor: true,
    workspaceId: share.workspaceId ?? undefined,
  });

  return { aiAgentService, share };
};

export const runControlRouter = router({
  /**
   * Resolve an intervention (approve / reject / answer / skip / stop) parked on
   * the VISITOR's own share run — the visitor counterpart of
   * `aiAgent.resolveAgentInterventionBySource`. A share run is approved by the
   * visitor: granting a tool to visitors grants its normal approval flow.
   *
   * The visitor must own `topicId` under this live share; the business slot
   * then binds the durable batch to exactly this creator/agent/topic and a
   * share-run operation, so a visitor can never resolve anyone else's run and
   * the owner can never resolve a visitor's run through their own endpoints.
   * The continuation is dispatched under a `shareGate` rebuilt from the live
   * share row (see {@link createShareRunScope}).
   *
   * `unavailable` means the deployment has no durable intervention store (OSS);
   * the client then falls back to `execAgent`'s legacy `resume*` payloads.
   */
  resolveInterventionBySource: shareChatProcedure
    .input(
      ResolveAgentInterventionBySourceSchema.extend({
        shareId: z.string(),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { shareId, topicId, ...source } = input;
      const share = await resolveLinkShareOrThrow(ctx.serverDB, shareId, ctx.userId);
      const { dispatchContext, topicModel } = await createShareRunScope(
        ctx.serverDB,
        share,
        ctx.userId,
      );
      await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId,
        visitorUserId: ctx.userId,
      });

      // A server-side `remember` writes the OWNER's allow list, so a visitor
      // may only approve once here; their "don't ask again" goes to their own
      // allow list client-side (see `approveToolCalling`).
      if (source.action.type === 'approve_tool' && source.action.scope === 'remember') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Visitors can only approve once' });
      }

      log(
        'resolveInterventionBySource: share=%s visitor=%s topic=%s operation=%s action=%s',
        shareId,
        ctx.userId,
        topicId,
        source.operationId,
        source.action.type,
      );

      const resolution = await resolveAgentInterventionBySource({
        ...source,
        actorUserId: ctx.userId,
        shareVisitor: { agentId: share.agentId, ownerUserId: share.ownerId, topicId },
        workspaceId: share.workspaceId ?? undefined,
      }).catch((error: unknown) => {
        throw mapAgentInterventionTRPCError(error);
      });

      if (!resolution.handled) {
        return {
          contractVersion: 2 as const,
          status: 'unavailable' as const,
          success: false as const,
        };
      }
      if (resolution.state === 'already_resolved') {
        return {
          contractVersion: 2 as const,
          state: resolution.state,
          status: resolution.status,
          success: true as const,
        };
      }

      try {
        const dispatch = await dispatchClaimedAgentIntervention(resolution, dispatchContext);
        return {
          contractVersion: 2 as const,
          ...(dispatch.execution && { execution: toClientExecAgentResult(dispatch.execution) }),
          state: resolution.state,
          status: dispatch.status,
          success: true as const,
        };
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('resolveInterventionBySource', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),
  /**
   * Stop the visitor's own parked run from its pending approval card — the
   * visitor counterpart of `aiAgent.stopPendingApproval`, used when the
   * deployment has no durable intervention store (OSS) or the rows predate it.
   * `InterventionController.stopPendingApproval` re-checks that the operation
   * is the parked owner of `topicId` and every message belongs to it.
   */
  stopPendingApproval: shareChatProcedure
    .input(
      ShareTopicScopeSchema.extend({
        batchId: z.string().min(1),
        operationId: z.string().min(1),
        toolMessageIds: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);
      const { aiAgentService, dispatchContext, messageModel, topicModel } =
        await createShareRunScope(ctx.serverDB, share, ctx.userId);
      await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId: input.topicId,
        visitorUserId: ctx.userId,
      });

      const stopPlugins = await pMap(
        input.toolMessageIds,
        (id) => messageModel.findMessagePlugin(id),
        { concurrency: 5 },
      );
      const hasGenericSource = stopPlugins.every(
        (plugin) =>
          Boolean(plugin?.toolCallId) &&
          plugin?.intervention?.operationId === input.operationId &&
          plugin.intervention.batchId === input.batchId,
      );
      if (hasGenericSource) {
        const sourceResolution = await resolveAgentInterventionBySource({
          action: { scope: 'operation', type: 'stop' },
          actorUserId: ctx.userId,
          batchId: input.batchId,
          operationId: input.operationId,
          resolutionRequestId: randomUUID(),
          shareVisitor: {
            agentId: share.agentId,
            ownerUserId: share.ownerId,
            topicId: input.topicId,
          },
          targets: stopPlugins.map((plugin, index) => ({
            toolCallId: plugin!.toolCallId!,
            toolMessageId: input.toolMessageIds[index],
          })),
          workspaceId: share.workspaceId ?? undefined,
        }).catch((error: unknown) => {
          throw mapAgentInterventionTRPCError(error);
        });
        if (sourceResolution.handled) {
          if (sourceResolution.state === 'already_resolved') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'This approval has already been resolved.',
            });
          }
          try {
            await dispatchClaimedAgentIntervention(sourceResolution, dispatchContext);
          } catch (error: any) {
            if (error instanceof TRPCError) throw error;

            throw toVisitorSafeStartupError('stopPendingApproval', error, {
              showErrorDetails: share.shareConfig.showErrorDetails,
            });
          }
          return {
            operationId: input.operationId,
            settledToolMessageIds: input.toolMessageIds,
            success: true,
          };
        }
      }

      try {
        return await aiAgentService.stopPendingApproval({
          batchId: input.batchId,
          operationId: input.operationId,
          toolMessageIds: input.toolMessageIds,
          topicId: input.topicId,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('stopPendingApproval', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),
  /**
   * Interrupt a running share operation — the visitor counterpart of
   * `aiAgent.interruptTask`. Visitors have no owner-scoped access to
   * `aiAgent.interruptTask` (its models are scoped to the caller, and share
   * runs execute under the CREATOR's identity), so without this endpoint a
   * visitor's Stop / tab-close cannot reach the server: the run keeps streaming
   * and consuming the creator's budget until it finishes on its own.
   *
   * Authorization is intentionally stricter than `execAgent`/`getMessages`;
   * see {@link authorizeVisitorRunningOperation}.
   */
  interruptTask: shareChatProcedure
    .input(ShareTopicScopeSchema.extend({ operationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { aiAgentService, share } = await authorizeVisitorRunningOperation(
        ctx.serverDB,
        ctx.userId,
        input,
      );

      log(
        'interruptTask: share=%s visitor=%s topic=%s operation=%s',
        input.shareId,
        ctx.userId,
        input.topicId,
        input.operationId,
      );

      try {
        return await aiAgentService.interruptTask({
          operationId: input.operationId,
          topicId: input.topicId,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('interruptTask', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),
  /**
   * The visitor counterpart of `aiAgent.setQueuedMessages`: a visitor can queue
   * follow-ups behind a share run too, and needs the same early hand-back.
   * Authorized exactly like `interruptTask`.
   */
  setQueuedMessages: shareChatProcedure
    .input(ShareTopicScopeSchema.extend({ operationId: z.string(), pending: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { aiAgentService, share } = await authorizeVisitorRunningOperation(
        ctx.serverDB,
        ctx.userId,
        input,
      );

      log(
        'setQueuedMessages: share=%s visitor=%s topic=%s operation=%s pending=%s',
        input.shareId,
        ctx.userId,
        input.topicId,
        input.operationId,
        input.pending,
      );

      try {
        return await aiAgentService.setQueuedMessages({
          operationId: input.operationId,
          pending: input.pending,
        });
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw toVisitorSafeStartupError('setQueuedMessages', error, {
          showErrorDetails: share.shareConfig.showErrorDetails,
        });
      }
    }),
});
