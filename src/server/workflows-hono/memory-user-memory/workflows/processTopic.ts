import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildUpstashWorkflowAttributes,
  tracer as upstashWorkflowTracer,
} from '@lobechat/observability-otel/modules/upstash-workflow';
import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { errorMessageFrom } from '@lobechat/utils';
import { type WorkflowContext } from '@upstash/workflow';
import { WorkflowAbort, WorkflowNonRetryableError } from '@upstash/workflow';
import { createWorkflow } from '@upstash/workflow/hono';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { type MemoryExtractionPayloadInput } from '@/server/services/memory/userMemory/extract';
import {
  MemoryExtractionExecutor,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

import { createWorkflowQstashClient } from '../qstashClient';

const CEPA_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];

const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];

const processTopicRoute = async (context: WorkflowContext<MemoryExtractionPayloadInput>) =>
  upstashWorkflowTracer.startActiveSpan(
    'workflow:memory-user-memory:process-topic',
    async (span) => {
      const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});

      span.setAttributes({
        ...buildUpstashWorkflowAttributes(context),
        'workflow.memory_user_memory.layers': payload.layers.join(','),
        'workflow.memory_user_memory.source': payload.sources.join(','),
        'workflow.memory_user_memory.topic_id': payload.topicIds[0],
        'workflow.memory_user_memory.user_id': payload.userIds[0],
        'workflow.name': 'memory-user-memory:process-topic',
      });

      const topicId = payload.topicIds[0];
      const userId = payload.userIds[0];

      if (!userId || !topicId) {
        span.setStatus({ code: SpanStatusCode.OK });
        return { message: 'Missing userId or topicId for topic workflow.' };
      }

      if (!payload.sources.includes(MemorySourceType.ChatTopic)) {
        span.setStatus({ code: SpanStatusCode.OK });
        return { message: 'Source not supported in topic workflow.' };
      }

      const executor = await MemoryExtractionExecutor.create();

      try {
        if (payload.asyncTaskId) {
          // NOTICE: Cooperative cascading cancellation for the workflow tree.
          // Check before CEPA extraction so cancelled tasks stop at the earliest safe boundary.
          const cancelled = await context.run(
            `memory:user-memory:extract:users:${userId}:topics:${topicId}:cancel-check:before`,
            () =>
              getServerDB().then((db) =>
                new AsyncTaskModel(db, userId).isUserMemoryExtractionCancellationRequested(
                  payload.asyncTaskId!,
                ),
              ),
          );
          if (cancelled) {
            span.setStatus({ code: SpanStatusCode.OK });
            return { message: 'Memory extraction task cancellation requested, skip topic.' };
          }
        }

        {
          let layers = CEPA_LAYERS;
          if (payload.layers.length) {
            layers = payload.layers.filter((layer) => CEPA_LAYERS.includes(layer));
          }

          await context.run(
            `memory:user-memory:extract:users:${userId}:topics:${topicId}:cepa`,
            () =>
              executor.extractTopic({
                asyncTaskId: payload.asyncTaskId,
                forceAll: payload.forceAll,
                forceTopics: payload.forceTopics,
                from: payload.from,
                layers,
                source: MemorySourceType.ChatTopic,
                to: payload.to,
                topicId,
                userId,
                userInitiated: payload.userInitiated,
              }),
          );
        }
        {
          if (payload.asyncTaskId) {
            // NOTICE: Cooperative cascading cancellation for the workflow tree.
            // Re-check before identity extraction to avoid running sequential identity step after cancel.
            const cancelled = await context.run(
              `memory:user-memory:extract:users:${userId}:topics:${topicId}:cancel-check:identity`,
              () =>
                getServerDB().then((db) =>
                  new AsyncTaskModel(db, userId).isUserMemoryExtractionCancellationRequested(
                    payload.asyncTaskId!,
                  ),
                ),
            );
            if (cancelled) {
              span.setStatus({ code: SpanStatusCode.OK });
              return {
                message: 'Memory extraction task cancellation requested, skip identity extraction.',
              };
            }
          }

          let layers = IDENTITY_LAYERS;
          if (payload.layers.length) {
            layers = payload.layers.filter((layer) => IDENTITY_LAYERS.includes(layer));
          }

          await context.run(
            `memory:user-memory:extract:users:${userId}:topics:${topicId}:identity`,
            () =>
              executor.extractTopic({
                asyncTaskId: payload.asyncTaskId,
                forceAll: payload.forceAll,
                forceTopics: payload.forceTopics,
                from: payload.from,
                layers,
                source: MemorySourceType.ChatTopic,
                to: payload.to,
                topicId,
                userId,
                userInitiated: payload.userInitiated,
              }),
          );
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return {
          processedTopics: 1,
          processedUsers: 1,
          topicId,
          userId,
        };
      } catch (error) {
        // Let Upstash internal aborts bubble through but treat others as non-retry-able
        if (error instanceof WorkflowAbort) throw error;

        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessageFrom(error) || 'process-topic workflow failed',
        });

        // Avoid infinite retries on non-retry-able errors
        throw new WorkflowNonRetryableError(
          errorMessageFrom(error) || 'process-topic workflow failed',
        );
      } finally {
        span.end();
      }
    },
  );

export const processTopicWorkflow = createWorkflow<MemoryExtractionPayloadInput, unknown>(
  processTopicRoute,
  {
    failureFunction: async ({ context, failStatus, failResponse }) => {
      try {
        const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});

        const userId = payload.userId || payload.userIds?.[0];
        const topicId = payload.topicIds?.[0];
        if (!userId || !payload.asyncTaskId) {
          return 'no-async-task';
        }

        const db = await getServerDB();
        const asyncTaskModel = new AsyncTaskModel(db, userId);

        await asyncTaskModel.incrementUserMemoryExtractionProgress(payload.asyncTaskId);
        console.error(
          `[process-topic][failureFunction] marking async task as failed for user ${userId}, topic ${topicId}`,
          {
            failResponse,
            failStatus,
          },
        );

        return 'async-task-updated';
      } catch (error) {
        console.error('[process-topic][failureFunction] failed to record async task error', error);
        return 'async-task-update-failed';
      }
    },
    qstashClient: createWorkflowQstashClient(),
  },
);

processTopicWorkflow.workflowId = 'process-topic';
