import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import {
  getAgentInterventionReview,
  getAgentInterventionReviewBySource,
  resolveAgentIntervention,
  resolveAgentInterventionBySource,
} from '@/business/server/agent-run/agentInterventionReview';
import { router } from '@/libs/trpc/lambda';
import { mapAgentInterventionTRPCError } from '@/server/routers/lambda/_helpers/agentInterventionError';
import { assertCanViewMessageTargets } from '@/server/routers/lambda/_helpers/conversationResourceGuard';
import { toClientExecAgentResult } from '@/server/routers/lambda/_helpers/groupMemberContinuationResult';
import {
  GetAgentInterventionReviewBySourceSchema,
  GetAgentInterventionReviewSchema,
  ResolveAgentInterventionBySourceSchema,
  ResolveAgentInterventionSchema,
} from '@/server/routers/lambda/_schema/agentIntervention';

import { assertCanUseAgentRunConversation, assertCanUseOperationAgent } from './guards';
import { dispatchClaimedAgentIntervention } from './interventionDispatch';
import { aiAgentBaseProcedure, aiAgentWriteProcedure } from './procedures';
import { acceptsFileWorksOf, acceptsMemberRuntimeEndOf } from './utils';

const log = debug('lobe-server:ai-agent-router');

/** Each tool message id is a separate plugin read; a large batch must not open them all at once. */
const TOOL_PLUGIN_LOOKUP_CONCURRENCY = 5;

const ProcessHumanInterventionSchema = z.object({
  action: z.enum(['approve', 'reject', 'reject_continue', 'input', 'select']),
  data: z
    .object({
      approvedToolCall: z.any().optional(),
      input: z.any().optional(),
      selection: z.any().optional(),
    })
    .optional(),
  operationId: z.string(),
  reason: z.string().optional(),
  stepIndex: z.number().optional().default(0),
  /**
   * ID of the pending `role='tool'` message targeted by this intervention.
   * Required for approve / reject / reject_continue so the server can update
   * the message's intervention status, content, and — on approve — hand the
   * id to the `call_tool` short-circuit via `skipCreateToolMessage`.
   */
  toolMessageId: z.string().optional(),
});

export const interventionRouter = router({
  /**
   * Interrupt a running task
   *
   * This endpoint interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  /**
   * Stop a run parked on tool approval: settle the pending tool rows and end
   * the operation without executing anything or continuing the model.
   *
   * Distinct from `interruptTask`, which only flips runtime state and assumes
   * a live loop will persist the outcome — a parked run has no loop, so its
   * tool rows and DB row would both be left behind.
   */
  stopPendingApproval: aiAgentWriteProcedure
    .input(
      z.object({
        /** Stable sealed batch id stamped on every pending tool row. */
        batchId: z.string().min(1),
        /** Exact parked operation to stop; never inferred from topic recency. */
        operationId: z.string().min(1),
        /** Pending `role='tool'` message ids to settle — the active batch. */
        toolMessageIds: z.array(z.string()).min(1),
        topicId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Same ownership gate the approval resume uses: every target must belong
      // to the caller before anything is written.
      await assertCanUseAgentRunConversation({
        db: ctx.serverDB,
        messageIds: input.toolMessageIds,
        topicId: input.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      const stopPlugins = await pMap(
        input.toolMessageIds,
        (id) => ctx.messageModel.findMessagePlugin(id),
        { concurrency: TOOL_PLUGIN_LOOKUP_CONCURRENCY },
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
          targets: stopPlugins.map((plugin, index) => ({
            toolCallId: plugin!.toolCallId!,
            toolMessageId: input.toolMessageIds[index],
          })),
          workspaceId: ctx.workspaceId ?? undefined,
        });
        if (sourceResolution.handled) {
          if (sourceResolution.state === 'already_resolved') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'This approval has already been resolved.',
            });
          }
          await dispatchClaimedAgentIntervention(sourceResolution, ctx);
          return {
            operationId: input.operationId,
            settledToolMessageIds: input.toolMessageIds,
            success: true,
          };
        }
      }

      return ctx.aiAgentService.stopPendingApproval({
        batchId: input.batchId,
        operationId: input.operationId,
        toolMessageIds: input.toolMessageIds,
        topicId: input.topicId,
      });
    }),
  /**
   * Authenticated v2 review lookup. The opaque token is only a locator: the
   * business implementation must resolve the row, then evaluate view and
   * resolve access against the intervention's current conversation resource.
   * Keep the token in a POST body rather than a query URL retained by access
   * logs and browser history.
   */
  getAgentInterventionReview: aiAgentBaseProcedure
    .input(GetAgentInterventionReviewSchema)
    .mutation(({ input, ctx }) =>
      getAgentInterventionReview({
        reviewToken: input.reviewToken,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      }),
    ),
  /**
   * Read-only counterpart to the active Web source resolver. Chat surfaces
   * fetch authoritative authorization before rendering controls, so a
   * view-only collaborator sees the request with actions disabled instead of
   * discovering the denial only after a mutation. Source ids remain locators;
   * Cloud applies the final resource ACL after resolving the durable row.
   */
  getAgentInterventionReviewBySource: aiAgentBaseProcedure
    .input(GetAgentInterventionReviewBySourceSchema)
    .mutation(async ({ input, ctx }) => {
      await assertCanViewMessageTargets(
        { db: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
        input.targets.map(({ toolMessageId }) => toolMessageId),
      );

      return getAgentInterventionReviewBySource({
        actorUserId: ctx.userId,
        batchId: input.batchId,
        operationId: input.operationId,
        targets: input.targets,
        workspaceId: ctx.workspaceId ?? undefined,
      });
    }),
  /**
   * Active Web approval bridge. Source ids only locate the durable runtime
   * rows; Cloud re-resolves their operation, sealed batch, membership,
   * revisions and conversation ACL before using the same atomic claim as
   * Review. OSS returns unavailable so its existing message-row path remains
   * the compatibility fallback.
   */
  resolveAgentInterventionBySource: aiAgentWriteProcedure
    .input(ResolveAgentInterventionBySourceSchema)
    .mutation(async ({ input, ctx }) => {
      await assertCanUseAgentRunConversation({
        db: ctx.serverDB,
        messageIds: input.targets.map(({ toolMessageId }) => toolMessageId),
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // A rejected resolution describes the submitted response, not a server
      // fault, so map the contract failure instead of letting it become a 500.
      const resolution = await resolveAgentInterventionBySource({
        action: input.action,
        actorUserId: ctx.userId,
        batchId: input.batchId,
        operationId: input.operationId,
        resolutionRequestId: input.resolutionRequestId,
        targets: input.targets,
        workspaceId: ctx.workspaceId ?? undefined,
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
          ...(resolution.conversationUrl && { conversationUrl: resolution.conversationUrl }),
          state: resolution.state,
          status: resolution.status,
          success: true as const,
        };
      }

      const dispatch = await dispatchClaimedAgentIntervention(resolution, ctx, {
        acceptsFileWorks: acceptsFileWorksOf(input.streamFeatures),
        acceptsMemberRuntimeEnd: acceptsMemberRuntimeEndOf(input.streamFeatures),
      });
      return {
        contractVersion: 2 as const,
        ...(resolution.conversationUrl && { conversationUrl: resolution.conversationUrl }),
        ...(dispatch.execution && { execution: toClientExecAgentResult(dispatch.execution) }),
        state: resolution.state,
        status: dispatch.status,
        success: true as const,
      };
    }),
  /**
   * Resolve one v2 review through the durable first-winner claim. The client
   * supplies only review/item ids plus revisions; the business slot derives
   * every runtime authority (operation, tool call, message, canonical tool
   * key) after ACL + batch membership checks.
   */
  resolveAgentIntervention: aiAgentWriteProcedure
    .input(ResolveAgentInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const resolution = await resolveAgentIntervention({
        action: input.action,
        expectedBatchVersion: input.expectedBatchVersion,
        expectedRequestRevisions: input.expectedRequestRevisions,
        resolutionRequestId: input.resolutionRequestId,
        reviewToken: input.reviewToken,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
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
          conversationUrl: resolution.conversationUrl,
          status: resolution.status,
          success: true as const,
        };
      }

      const { status: publishedStatus } = await dispatchClaimedAgentIntervention(resolution, ctx);

      return {
        contractVersion: 2 as const,
        conversationUrl: resolution.conversationUrl,
        status: publishedStatus,
        success: true as const,
      };
    }),
  processHumanIntervention: aiAgentWriteProcedure
    .input(ProcessHumanInterventionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, action, data, reason, stepIndex, toolMessageId } = input;

      log(`Processing ${action} for operation ${operationId}`);

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Build intervention parameters
      const interventionParams: any = {
        action,
        operationId,
        stepIndex,
        toolMessageId,
      };

      switch (action) {
        case 'approve': {
          if (!data?.approvedToolCall) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'approvedToolCall is required for approve action',
            });
          }
          interventionParams.approvedToolCall = data.approvedToolCall;
          // toolMessageId is required for the server to persist the
          // intervention + short-circuit into call_tool; the handler itself
          // no-ops when missing, so keep the schema permissive for legacy
          // callers that haven't been updated yet.
          break;
        }
        case 'reject':
        case 'reject_continue': {
          interventionParams.rejectionReason = reason || 'Tool call rejected by user';
          interventionParams.rejectAndContinue = action === 'reject_continue';
          break;
        }
        case 'input': {
          if (!data?.input) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'input is required for input action',
            });
          }
          interventionParams.humanInput = { response: data.input };
          break;
        }
        case 'select': {
          if (!data?.selection) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'selection is required for select action',
            });
          }
          interventionParams.humanInput = { selection: data.selection };
          break;
        }
      }

      // Process human intervention using AgentRuntimeService
      const result = await ctx.agentRuntimeService.processHumanIntervention(interventionParams);

      return {
        action,
        message: `Human intervention processed successfully. Execution resumed.`,
        operationId,
        scheduledMessageId: result.messageId,
        success: true,
        timestamp: new Date().toISOString(),
      };
    }),
});
