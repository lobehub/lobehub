import { TRANSFER_RESOURCE_TYPES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { startAgentTransferJob } from '@/business/server/agent-transfer/jobRunner';
import { notifyResourceTransfer } from '@/business/server/resource-transfer/notify';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AGENT_OWNERSHIP_STALE } from '@/database/models/agent';
import { AGENT_COPY_IN_PROGRESS } from '@/database/models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS } from '@/database/models/agentTransferJob';
import { CHAT_GROUP_OWNERSHIP_STALE } from '@/database/models/chatGroup';
import {
  ResourceTransferRequestModel,
  TRANSFER_REQUEST_EXPIRED,
  TRANSFER_REQUEST_NOT_PENDING,
} from '@/database/models/resourceTransferRequest';
import type { ResourceTransferRequestItem } from '@/database/schemas';
import { agents, chatGroups, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { executeAcceptedTransfer } from '@/server/services/resourceTransferRequest';
import { after } from '@/server/utils/scheduleAfterResponse';
import { TransferErrorCode } from '@/types/transferError';

const resourceInput = z.object({
  resourceId: z.string(),
  resourceType: z.enum(TRANSFER_RESOURCE_TYPES),
});

const requestIdInput = z.object({ requestId: z.string() });

/**
 * Transfer requests only exist inside a team workspace; personal mode has no
 * second member to hand anything to.
 */
const transferRequestProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  if (!ctx.workspaceId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Resource transfer requests only apply inside a workspace',
    });
  }

  return opts.next({
    ctx: {
      transferRequestModel: new ResourceTransferRequestModel(ctx.serverDB, ctx.workspaceId),
      workspaceId: ctx.workspaceId,
    },
  });
});

interface TransferRequestUserSummary {
  avatar: string | null;
  fullName: string | null;
  id: string;
  username: string | null;
}

interface TransferRequestResourceSummary {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

/**
 * Attach the display context a request row alone cannot provide: who the
 * counterpart users are and what the resource is called. Batched: one query
 * per table however many requests are listed.
 */
const enrichRequests = async (db: LobeChatDatabase, requests: ResourceTransferRequestItem[]) => {
  if (requests.length === 0) return [];

  // All requests here come from one workspace-scoped model; pinning the
  // resource lookups to that workspace keeps a stale request (resource moved
  // away, invalidation raced) from leaking the resource's post-move identity.
  const requestWorkspaceId = requests[0].workspaceId;

  const userIds = [
    ...new Set(
      requests.flatMap((request) =>
        [request.initiatorId, request.recipientId, request.previousOwnerId].filter(
          (id): id is string => !!id,
        ),
      ),
    ),
  ];
  const agentIds = [
    ...new Set(
      requests.filter((request) => request.resourceType === 'agent').map((r) => r.resourceId),
    ),
  ];
  const groupIds = [
    ...new Set(
      requests.filter((request) => request.resourceType === 'agentGroup').map((r) => r.resourceId),
    ),
  ];

  const [userRows, agentRows, groupRows] = await Promise.all([
    userIds.length > 0
      ? db
          .select({
            avatar: users.avatar,
            fullName: users.fullName,
            id: users.id,
            username: users.username,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    agentIds.length > 0
      ? db
          .select({
            avatar: agents.avatar,
            backgroundColor: agents.backgroundColor,
            id: agents.id,
            title: agents.title,
          })
          .from(agents)
          .where(and(inArray(agents.id, agentIds), eq(agents.workspaceId, requestWorkspaceId)))
      : Promise.resolve([]),
    groupIds.length > 0
      ? db
          .select({
            avatar: chatGroups.avatar,
            backgroundColor: chatGroups.backgroundColor,
            id: chatGroups.id,
            title: chatGroups.title,
          })
          .from(chatGroups)
          .where(
            and(inArray(chatGroups.id, groupIds), eq(chatGroups.workspaceId, requestWorkspaceId)),
          )
      : Promise.resolve([]),
  ]);

  const userById = new Map<string, TransferRequestUserSummary>(
    userRows.map((row) => [row.id, row]),
  );
  // Resource ids are globally unique per table and a request pins its type,
  // so one id-keyed map can serve every resource table.
  const resourceById = new Map<string, TransferRequestResourceSummary>(
    [...agentRows, ...groupRows].map((row) => [row.id, row]),
  );

  return requests.map((request) => ({
    ...request,
    initiator: request.initiatorId ? (userById.get(request.initiatorId) ?? null) : null,
    previousOwner: request.previousOwnerId ? (userById.get(request.previousOwnerId) ?? null) : null,
    recipient: request.recipientId ? (userById.get(request.recipientId) ?? null) : null,
    resource: resourceById.get(request.resourceId) ?? null,
  }));
};

export const resourceTransferRequestRouter = router({
  /**
   * Recipient accepts: the request flips and ownership is handed over in one
   * transaction. Large migrated histories continue through the standard
   * transfer backfill job after commit.
   */
  accept: transferRequestProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    const request = await ctx.transferRequestModel.findById(input.requestId);
    if (!request || request.recipientId !== ctx.userId) {
      // Same shape for "missing" and "not yours": request ids must not be probeable.
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Transfer request not found' });
    }

    try {
      const { transferJobId } = await executeAcceptedTransfer({
        db: ctx.serverDB,
        recipientId: ctx.userId,
        request,
        workspaceId: ctx.workspaceId,
      });
      if (transferJobId) startAgentTransferJob(ctx.serverDB, transferJobId);
      // Best-effort: outcome + courtesy notices must not fail the accept.
      // Scheduled with after() so serverless runtimes keep it alive past the
      // response.
      const notifyParams = {
        event: 'accepted' as const,
        initiatorId: request.initiatorId,
        previousOwnerId: request.previousOwnerId,
        recipientId: ctx.userId,
        requestId: request.id,
        resourceId: request.resourceId,
        resourceType: request.resourceType,
        workspaceId: ctx.workspaceId,
      };
      after(() =>
        notifyResourceTransfer(notifyParams).catch((error) =>
          console.error('[resourceTransferRequest:accept] notify failed', error),
        ),
      );
      return { data: { transferJobId }, success: true };
    } catch (error) {
      if (error instanceof TRPCError) {
        // The authority-stale refusal aborts the accept transaction, so the
        // retire has to happen here: without it the same permanently
        // unfulfillable request keeps rendering (and failing) until expiry.
        // Targeted at THIS request only — a racing replacement request for
        // the same resource must survive.
        const causeCode = (error.cause as { data?: { code?: unknown } } | undefined)?.data?.code;
        if (causeCode === TransferErrorCode.TransferRequestStale) {
          await ctx.transferRequestModel.invalidateRequest(request.id);
        }
        throw error;
      }
      if (error instanceof Error) {
        if (error.message === TRANSFER_REQUEST_EXPIRED) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'This transfer request expired' });
        }
        if (error.message === TRANSFER_REQUEST_NOT_PENDING) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This transfer request was already resolved',
          });
        }
        if (
          error.message === AGENT_OWNERSHIP_STALE ||
          error.message === CHAT_GROUP_OWNERSHIP_STALE
        ) {
          // The resource moved or changed hands since the request was created —
          // the request can never complete, so retire it.
          await ctx.transferRequestModel.invalidateForResources(request.resourceType, [
            request.resourceId,
          ]);
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferRequestStale } },
            code: 'CONFLICT',
            message: 'The resource changed since this request was created',
          });
        }
        if (error.message === AGENT_TRANSFER_IN_PROGRESS) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TransferInProgress } },
            code: 'CONFLICT',
            message: 'A previous transfer of this agent is still migrating its history',
          });
        }
        if (error.message === AGENT_COPY_IN_PROGRESS) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.CopyInProgress } },
            code: 'CONFLICT',
            message: 'A previous copy of this agent is still duplicating its history',
          });
        }
      }
      console.error('[resourceTransferRequest:accept]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to accept the transfer request',
      });
    }
  }),

  /** Initiator withdraws a pending request. */
  cancel: transferRequestProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    try {
      const request = await ctx.transferRequestModel.cancel(input.requestId, ctx.userId);
      return { data: request, success: true };
    } catch (error) {
      // A still-rendered request may cross `expiresAt` before the click lands:
      // an expected business outcome, not a server error.
      if (error instanceof Error && error.message === TRANSFER_REQUEST_EXPIRED) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This transfer request expired' });
      }
      if (error instanceof Error && error.message === TRANSFER_REQUEST_NOT_PENDING) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This transfer request was already resolved',
        });
      }
      console.error('[resourceTransferRequest:cancel]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to cancel the transfer request',
      });
    }
  }),

  /** Recipient declines; the resource stays with its owner. */
  decline: transferRequestProcedure.input(requestIdInput).mutation(async ({ ctx, input }) => {
    try {
      const request = await ctx.transferRequestModel.decline(input.requestId, ctx.userId);
      // Best-effort: the outcome notice must not fail the decline.
      // Scheduled with after() so serverless runtimes keep it alive past the
      // response.
      const notifyParams = {
        event: 'declined' as const,
        initiatorId: request.initiatorId,
        previousOwnerId: request.previousOwnerId,
        recipientId: ctx.userId,
        requestId: request.id,
        resourceId: request.resourceId,
        resourceType: request.resourceType,
        workspaceId: ctx.workspaceId,
      };
      after(() =>
        notifyResourceTransfer(notifyParams).catch((error) =>
          console.error('[resourceTransferRequest:decline] notify failed', error),
        ),
      );
      return { data: request, success: true };
    } catch (error) {
      // A still-rendered request may cross `expiresAt` before the click lands:
      // an expected business outcome, not a server error.
      if (error instanceof Error && error.message === TRANSFER_REQUEST_EXPIRED) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This transfer request expired' });
      }
      if (error instanceof Error && error.message === TRANSFER_REQUEST_NOT_PENDING) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This transfer request was already resolved',
        });
      }
      console.error('[resourceTransferRequest:decline]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to decline the transfer request',
      });
    }
  }),

  /**
   * The live request on one resource, for the resource page banner. Only the
   * two parties see it; everyone else gets `null` (not an error — the banner
   * probe runs for every viewer).
   */
  getPendingByResource: transferRequestProcedure
    .input(resourceInput)
    .query(async ({ ctx, input }) => {
      const request = await ctx.transferRequestModel.findPendingByResource(
        input.resourceType,
        input.resourceId,
      );
      if (!request || (request.recipientId !== ctx.userId && request.initiatorId !== ctx.userId)) {
        return { data: null, success: true };
      }

      const [enriched] = await enrichRequests(ctx.serverDB, [request]);
      return { data: enriched, success: true };
    }),

  /** Live requests where the caller is recipient (to answer) or initiator (to track/withdraw). */
  listMine: transferRequestProcedure.query(async ({ ctx }) => {
    const requests = await ctx.transferRequestModel.listPendingForUser(ctx.userId);
    return { data: await enrichRequests(ctx.serverDB, requests), success: true };
  }),
});
