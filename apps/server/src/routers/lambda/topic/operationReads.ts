import { TRPCError } from '@trpc/server';

import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { TopicReferenceService } from '@/server/services/topicReference';

import { readTopicTranscript, topicTranscriptInput } from './transcript';

/**
 * The topic read a device-dispatched run needs, under its own identity.
 *
 * Those runs hold a `hetero-operation` JWT, which `oidcAuth` refuses on the
 * ordinary route, so `lh topic view` failed whenever the user pointed the agent
 * at an earlier conversation — the most common thing a run asks LobeHub for.
 * The workaround was the machine's stored login, which on a shared workspace
 * device belongs to whoever enrolled it, not to the member whose run this is.
 * This route answers with the run's own principal instead.
 *
 * Scope is the operation's principal AND its conversation: a token reads its own
 * conversation and the conversations a user message in it names (a bare id or a
 * `<refer_topic>` tag). A leaked token therefore reaches what the user pointed
 * this run at — not every topic of the workspace whose id it learns. Anything
 * else is refused before the topic is looked up, so the refusal says nothing
 * about whether it exists.
 *
 * The capability is `hetero:ingest`, as for the Goal operation reads: every run
 * token carries it, and a new capability would make pods that predate it reject
 * the whole token — ingest included — during a rolling deploy.
 * `allowTerminalOperation` stays unset: the token reads only while its run runs.
 */
const topicOperationReadProcedure = heteroAuthedProcedure.use(serverDatabase).use(async (opts) => {
  if (opts.ctx.heteroAuthKind !== 'operation' || !opts.ctx.heteroOperation) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'An operation-bound token is required',
    });
  }
  let principal;
  try {
    principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'hetero:ingest',
      claims: opts.ctx.heteroOperation,
      db: opts.ctx.serverDB,
      operationId: opts.ctx.heteroOperation.operation_id,
    });
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
  return opts.next({
    ctx: {
      topicReference: new TopicReferenceService(
        opts.ctx.serverDB,
        principal.userId,
        principal.workspaceId,
      ),
      operationTopicId: principal.topicId,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
    },
  });
});

export const operationReadRouter = router({
  getTopicTranscriptOperation: topicOperationReadProcedure
    .input(topicTranscriptInput)
    .query(async ({ ctx, input }) => {
      const reachable =
        !!ctx.operationTopicId &&
        (await ctx.topicReference.isNamedInConversation(ctx.operationTopicId, input.topicId));
      if (!reachable) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            "This run can read its own conversation and the ones the user names in it; this topic isn't one of them.",
        });
      }

      return readTopicTranscript(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        input,
      );
    }),
});
