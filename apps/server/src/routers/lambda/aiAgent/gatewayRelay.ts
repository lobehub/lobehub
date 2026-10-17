import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { signUserJWT } from '@/libs/trpc/utils/internalJwt';

import { LlmExecutorSchema } from './execSchemas';
import { aiAgentProcedure, aiAgentWriteProcedure } from './procedures';

export const gatewayRelayProcedures = {
  /**
   * Runs of the caller parked in `waiting_for_client`: their next LLM call needs
   * the user's device and no client took it. A client that can run the provider
   * continues them with `resumeClientLlmWait`.
   */
  listClientLlmWaits: aiAgentProcedure
    .input(z.object({ providers: z.array(z.string().min(1)).max(256).optional() }).optional())
    .query(async ({ input, ctx }) => {
      return ctx.aiAgentService.listClientLlmWaits(input?.providers);
    }),
  /**
   * Continue a run parked in `waiting_for_client` from the step it parked on,
   * with the calling client as the run's relay executor. `resumed: false` when
   * the run is no longer parked (already resumed, expired or stopped).
   */
  resumeClientLlmWait: aiAgentWriteProcedure
    .input(z.object({ llmExecutor: LlmExecutorSchema, operationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiAgentService.resumeFromClientLlmWait(input);
    }),
  /**
   * The tab stopped standing by on the relay channel it named in
   * `execSubAgentTask` (the sub-agent finished or was given up): end it.
   */
  releaseSubAgentLlmRelay: aiAgentWriteProcedure
    .input(z.object({ channel: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiAgentService.releaseSubAgentLlmRelay(input.channel);
    }),
  /**
   * Mint the per-USER Gateway JWT for the multiplexed v2 WebSocket (one
   * socket per user, `GET /v2/ws`). Unlike `refreshGatewayToken` it is not
   * bound to a running operation: the user hub authorizes every `subscribe`
   * against the op's registered owner, so the token only has to carry the
   * caller's identity. Short-lived (5m) like the v1 token; the client re-mints
   * before every connect attempt.
   *
   * Blocked for restricted API keys (`TRPC_BLOCKED_PATH_PREFIXES`), like
   * `refreshGatewayToken`: the JWT it returns passes `oidcAuth` as ordinary
   * non-API-key auth, so a scoped key must never be able to mint one.
   */
  issueGatewayUserToken: aiAgentProcedure.query(async ({ ctx }) => {
    const token = await signUserJWT(ctx.userId);

    return { token };
  }),
  /**
   * Refresh Gateway JWT token for an existing operation.
   * Used when reconnecting after page reload (original token expired).
   */
  refreshGatewayToken: aiAgentProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify the topic belongs to this user and has a running operation.
      // Use the creator-facing finder: a creator must not mint a token
      // against a visitor's running operation; visitors use
      // `shareChat.refreshGatewayToken` instead.
      const topic = await ctx.topicModel.findOwnTopicById(input.topicId);

      // Same liveness check as `shareChat.refreshGatewayToken`: the marker is
      // cleared best-effort, so refuse to reconnect a client to a run that has
      // already ended — the client treats NOT_FOUND as "stale marker, clear it".
      const runningOperation = topic?.metadata?.runningOperation;
      if (
        !runningOperation ||
        !(await ctx.topicModel.isRunningOperationAlive(ctx.serverDB, runningOperation))
      ) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No running operation found on this topic',
        });
      }

      const token = await signUserJWT(ctx.userId);

      return { token };
    }),
};
