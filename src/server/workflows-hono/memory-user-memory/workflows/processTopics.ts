import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildUpstashWorkflowMetricAttributes,
  tracer as upstashWorkflowTracer,
} from '@lobechat/observability-otel/modules/upstash-workflow';
import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { type WorkflowContext } from '@upstash/workflow';
import { WorkflowAbort } from '@upstash/workflow';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { type MemoryExtractionPayloadInput } from '@/server/services/memory/userMemory/extract';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

import { checkGuard } from './runGuard';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();
const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/chat-topic/process-topics';

const CEPA_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];
const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];

export const processTopicsHandler = (context: WorkflowContext<MemoryExtractionPayloadInput>) =>
  upstashWorkflowTracer.startActiveSpan(
    'workflow:memory-user-memory:process-topics',
    async (span) => {
      const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});

      span.setAttributes({
        ...buildUpstashWorkflowMetricAttributes(context),
        'workflow.memory_user_memory.force_all': payload.forceAll,
        'workflow.memory_user_memory.force_topics': payload.forceTopics,
        'workflow.memory_user_memory.layers': payload.layers.join(','),
        'workflow.memory_user_memory.source': payload.sources.join(','),
        'workflow.memory_user_memory.topic_count': payload.topicIds.length,
        'workflow.memory_user_memory.user_count': payload.userIds.length,
        'workflow.name': 'memory-user-memory:process-topics',
      });

      try {
        // NOTICE: Return (never throw) on a guard match — a throw before the first step makes
        // Upstash re-enqueue the run, turning a "disable" guard into an infinite retry storm.
        const entryGuard = await checkGuard(context, WORKFLOW_PATH, {
          response: { processedTopics: 0, processedUsers: 0 },
        });
        if (!entryGuard.result) {
          span.setStatus({ code: SpanStatusCode.OK });
          return entryGuard.response;
        }

        if (!payload.userIds.length) {
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            message: 'No user id provided for topic batch.',
            processedTopics: 0,
            processedUsers: 0,
          };
        }
        if (!payload.topicIds.length) {
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            message: 'No topic ids provided for extraction.',
            processedTopics: 0,
            processedUsers: 0,
          };
        }
        if (!payload.sources.includes(MemorySourceType.ChatTopic)) {
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            message: 'Source not supported in topic batch.',
            processedTopics: 0,
            processedUsers: 0,
          };
        }

        const userId = payload.userIds[0];
        if (payload.asyncTaskId && userId) {
          // NOTICE: Cooperative cascading cancellation for the workflow tree.
          // If cancelled, stop before fan-out into per-topic child workflows.
          const stepName = `memory:user-memory:extract:users:${userId}:cancel-check`;
          const guard = await checkGuard(context, WORKFLOW_PATH, {
            response: { processedTopics: 0, processedUsers: 0 },
            stepName,
          });
          if (!guard.result) {
            span.setStatus({ code: SpanStatusCode.OK });
            return guard.response;
          }

          const cancelled = await context.run(stepName, () =>
            getServerDB().then((db) =>
              new AsyncTaskModel(
                db,
                userId,
                payload.workspaceId,
              ).isUserMemoryExtractionCancellationRequested(payload.asyncTaskId!),
            ),
          );
          if (cancelled) {
            span.setStatus({ code: SpanStatusCode.OK });
            return {
              message: 'Memory extraction task cancellation requested, skip topic batch.',
              processedTopics: 0,
              processedUsers: 0,
            };
          }
        }
        // Fan out per-topic extraction as independent fire-and-forget workflow runs (replaces the
        // former context.invoke). triggerProcessTopic applies a per-user flowControl key so a single
        // user's concurrent process-topic runs stay bounded; the hard per-user, per-run topic
        // ceiling is enforced upstream in process-user-topics.
        for (const [index, topicId] of payload.topicIds.entries()) {
          const stepName = `memory:user-memory:extract:users:${userId}:topics:${topicId}:trigger:${index}`;
          const guard = await checkGuard(context, WORKFLOW_PATH, {
            response: { processedTopics: 0, processedUsers: 0 },
            stepName,
          });
          if (!guard.result) {
            span.setStatus({ code: SpanStatusCode.OK });
            return guard.response;
          }

          await context.run(stepName, () =>
            MemoryExtractionWorkflowService.triggerProcessTopic(
              userId,
              {
                ...buildWorkflowPayloadInput(payload),
                layers: payload.layers.length
                  ? payload.layers
                  : [...CEPA_LAYERS, ...IDENTITY_LAYERS],
                topicIds: [topicId],
                userId,
                userIds: [userId],
              },
              { extraHeaders: upstashWorkflowExtraHeaders },
            ),
          );
        }

        // Trigger user persona update after topic processing using the workflow client.
        const personaUpdateStepName = `memory:user-memory:users:${userId}`;
        const personaUpdateGuard = await checkGuard(context, WORKFLOW_PATH, {
          response: { processedTopics: 0, processedUsers: 0 },
          stepName: personaUpdateStepName,
        });
        if (!personaUpdateGuard.result) {
          span.setStatus({ code: SpanStatusCode.OK });
          return personaUpdateGuard.response;
        }

        await context.run(personaUpdateStepName, async () => {
          await MemoryExtractionWorkflowService.triggerPersonaUpdate(userId, payload.baseUrl, {
            extraHeaders: upstashWorkflowExtraHeaders,
          });
        });

        span.setStatus({ code: SpanStatusCode.OK });

        return {
          processedTopics: payload.topicIds.length,
          processedUsers: payload.userIds.length,
        };
      } catch (error) {
        // NOTICE: Let WorkflowAbort bubble up (used internally by Upstash); record others
        if (error instanceof WorkflowAbort) {
          console.warn('workflow aborted:', error.message);
          throw error;
        }

        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'process-topics workflow failed',
        });

        throw error;
      } finally {
        span.end();
      }
    },
  );

// NOTICE: Serve-side flow control governs a running workflow's own step-continuation messages
// (the QStash callbacks that advance each `context.run`). Without it, every process-topics step
// callback is published with NO flow-control key and lands in the shared "$" (unbound) bucket,
// which floods when steps retry (e.g. the auth-failure retry storm). `triggerProcessTopics`
// additionally sets a per-user key for the *initial* delivery; serve-side flow control can only
// use a static (config-time) key, so this global key bounds concurrent step execution and, more
// importantly, keeps step callbacks out of "$". Parallelism is a conservative global cap — the
// per-user trigger key (parallelism 20) remains the primary per-user throttle.
export const processTopicsWorkflowOptions = {
  flowControl: {
    key: 'memory-user-memory.pipelines.chat-topic.process-topics',
    parallelism: 20,
  },
};
