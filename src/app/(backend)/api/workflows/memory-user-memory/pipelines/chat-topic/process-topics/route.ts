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
  MemoryExtractionExecutor,
  type MemoryExtractionPayloadInput,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

const CEP_LAYERS: LayersEnum[] = [LayersEnum.Context, LayersEnum.Experience, LayersEnum.Preference];
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
          console.log('[chat-topic][batch] Starting batch topic processing workflow', {
            topicIds: payload.topicIds,
            userIds: payload.userIds,
          });

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
          const executor = await MemoryExtractionExecutor.create();

          // CEP: run in parallel across the batch
          await Promise.all(
            payload.topicIds.map((topicId, index) =>
              context.run(
                `memory:user-memory:extract:users:${userId}:topics:${topicId}:cep:${index}`,
                () =>
                  executor.extractTopic({
                    forceAll: payload.forceAll,
                    forceTopics: payload.forceTopics,
                    from: payload.from,
                    layers: CEP_LAYERS,
                    source: MemorySourceType.ChatTopic,
                    to: payload.to,
                    topicId,
                    userId,
                  }),
              ),
            ),
          );

          // Identity: run sequentially for the batch
          for (const [index, topicId] of payload.topicIds.entries()) {
            await context.run(
              `memory:user-memory:extract:users:${userId}:topics:${topicId}:identity:${index}`,
              () =>
                executor.extractTopic({
                  forceAll: payload.forceAll,
                  forceTopics: payload.forceTopics,
                  from: payload.from,
                  layers: IDENTITY_LAYERS,
                  source: MemorySourceType.ChatTopic,
                  to: payload.to,
                  topicId,
                  userId,
                }),
            );
          }

          console.log('[chat-topic][batch] Batch topic processing workflow completed', {
            processedTopics: payload.topicIds.length,
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
