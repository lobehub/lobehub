import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';

import { findVisitorTopicOrThrow, resolveLinkShareOrThrow } from './guards';
import { shareChatProcedure, ShareTopicScopeSchema } from './procedures';

export const gatewayRouter = router({
  /**
   * Mint the per-VISITOR Gateway JWT for the multiplexed v2 WebSocket — the
   * visitor counterpart of `aiAgent.issueGatewayUserToken`. Same subject rule
   * as `refreshGatewayToken` (sign for the visitor: share ops register their
   * stream under `streamOwnerUserId = visitor`, and the hub keys on the JWT
   * `sub`), but without a running-operation check: the token authenticates the
   * user hub socket, and each `subscribe` is authorized per op by the gateway.
   * The share must still resolve as link-visible for this caller so a revoked
   * or private share cannot be used to open a hub socket from its page.
   */
  issueGatewayUserToken: shareChatProcedure
    .input(z.object({ shareId: z.string() }))
    .query(async ({ input, ctx }) => {
      await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),
  /**
   * Refresh the Gateway WS JWT for a running share operation — the visitor
   * counterpart of `aiAgent.refreshGatewayToken` (which cannot serve visitors:
   * its TopicModel is scoped to the caller, and share topics belong to the
   * creator). Signs for the VISITOR — the gateway channel is registered under
   * their id (`streamOwnerUserId`), and a creator-signed token in the visitor's
   * browser would be creator account access.
   */
  refreshGatewayToken: shareChatProcedure
    .input(ShareTopicScopeSchema)
    .query(async ({ input, ctx }) => {
      const share = await resolveLinkShareOrThrow(ctx.serverDB, input.shareId, ctx.userId);

      const topicModel = new TopicModel(
        ctx.serverDB,
        share.ownerId,
        share.workspaceId ?? undefined,
        undefined,
        { includeShareVisitor: true },
      );
      const topic = await findVisitorTopicOrThrow(topicModel, {
        agentId: share.agentId,
        topicId: input.topicId,
        visitorUserId: ctx.userId,
      });

      // A present marker is not proof of a live run: it is cleared best-effort
      // at finish, so a stale one would send the visitor's browser to reconnect
      // to a finished operation, register it as "running" locally, and drop the
      // topic's fetched history as in-flight noise (a frozen skeleton list).
      // NOT_FOUND is what the client already treats as "stale marker, clear it".
      const runningOperation = topic.metadata?.runningOperation;
      if (
        !runningOperation ||
        !(await topicModel.isRunningOperationAlive(ctx.serverDB, runningOperation))
      ) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No running operation found on this topic',
        });
      }

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),
});
