import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  buildUpstashWorkflowAttributes,
  tracer as upstashWorkflowTracer,
} from '@lobechat/observability-otel/modules/upstash-workflow';
import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { Client } from '@upstash/qstash';
import { WorkflowAbort } from '@upstash/workflow';
import { serve } from '@upstash/workflow/nextjs';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  type MemoryExtractionPayloadInput,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

import { processTopicWorkflow } from '../process-topic/workflows/topic';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

const CEPA_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];
const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];

export const { POST } = serve<MemoryExtractionPayloadInput>(
  (context) =>
    upstashWorkflowTracer.startActiveSpan(
      'workflow:memory-user-memory:process-topics',
      async (span) => {
        const payload = normalizeMemoryExtractionPayload(context.requestPayload || {});

        span.setAttributes({
          ...buildUpstashWorkflowAttributes(context),
          'workflow.memory_user_memory.force_all': payload.forceAll,
          'workflow.memory_user_memory.force_topics': payload.forceTopics,
          'workflow.memory_user_memory.layers': payload.layers.join(','),
          'workflow.memory_user_memory.source': payload.sources.join(','),
          'workflow.memory_user_memory.topic_count': payload.topicIds.length,
          'workflow.memory_user_memory.user_count': payload.userIds.length,
          'workflow.name': 'memory-user-memory:process-topics',
        });

        try {
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
          // Delegate per-topic extraction to dedicated workflow for better isolation
          await Promise.all(
            payload.topicIds.map(async (topicId, index) => {
              await context.invoke(
                `memory:user-memory:extract:users:${userId}:topics:${topicId}:invoke:${index}`,
                {
                  body: {
                    ...payload,
                    layers: payload.layers.length
                      ? payload.layers
                      : [...CEPA_LAYERS, ...IDENTITY_LAYERS],
                    topicIds: [topicId],
                    userId,
                    userIds: [userId],
                  },
                  // CEPA: run in parallel across the batch
                  //
                  // NOTICE: if modified the parallelism of CEPA_LAYERS
                  // or added new memory layer, make sure to update the number below.
                  //
                  // Currently, CEPA (context, experience, preference, activity) + identity = 5 layers.
                  // and since identity requires sequential processing, we set parallelism to 5.
                  flowControl: {
                    key: `memory-user-memory.pipelines.chat-topic.process-topic.user.${userId}.topic.${topicId}`,
                    parallelism: 5,
                  },
                  headers: upstashWorkflowExtraHeaders,
                  workflow: processTopicWorkflow,
                },
              );
            }),
          );

          // Trigger user persona update after topic processing using the workflow client.
          await context.run(`memory:user-memory:users:${userId}`, async () => {
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
    ),
  {
    // NOTICE(@nekomeowww): Here as scenarios like Vercel Deployment Protection,
    // intermediate context.run(...) won't offer customizable headers like context.trigger(...) / client.trigger(...)
    // for passing additional headers, we have to provide a custom QStash client with the required headers here.
    //
    // Refer to the doc for more details:
    // https://upstash.com/docs/workflow/troubleshooting/vercel#step-2-pass-header-when-triggering
    qstashClient: new Client({
      headers: {
        ...upstashWorkflowExtraHeaders,
      },
      token: process.env.QSTASH_TOKEN!,
    }),
  },
);
