import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { createWorkflow } from '@upstash/workflow/nextjs';

import {
  MemoryExtractionExecutor,
  type MemoryExtractionPayloadInput,
  TOPIC_WORKFLOW_NAMES,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

type ExtractionResult = {
  extracted: boolean;
  layers: Record<string, number>;
  memoryIds: string[];
  topicId: string;
  userId: string;
};

// NOTICE: CEP stands for Context, Experience, Preference layers
const CEP_LAYERS: LayersEnum[] = [LayersEnum.Context, LayersEnum.Experience, LayersEnum.Preference];
const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];
const CEP_PARALLEL_BATCH_SIZE = 4;

const intersectLayers = (requested: LayersEnum[], allowed: LayersEnum[]) => {
  if (!requested.length) return allowed;

  const requestedSet = new Set(requested);
  return allowed.filter((layer) => requestedSet.has(layer));
};

export const createLayerWorkflow = (allowedLayers: LayersEnum[]) =>
  createWorkflow<MemoryExtractionPayloadInput, { processed: number; results: ExtractionResult[] }>(
    async (context) => {
      console.log('[chat-topic][layer] Starting layer processing workflow', {
        allowedLayers,
      });

      const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
      if (!params.userIds.length) {
        return { message: 'No user id provided for topic batch.', processed: 0, results: [] };
      }
      if (!params.topicIds.length) {
        return { message: 'No topic ids provided for extraction.', processed: 0, results: [] };
      }
      if (!params.sources.includes(MemorySourceType.ChatTopic)) {
        return { message: 'Source not supported in topic batch.', processed: 0, results: [] };
      }

      const userId = params.userIds[0];
      // NOTICE:
      // - if [contexts, preferences, experiences] are requested, we extract all 3 layers
      // - if [identity] is requested, we extract only identity layer
      // - if [contexts, preferences, experiences, identity] are requested, while allowedLayers is [contexts, preferences, experiences],
      //   we will extract only [contexts, preferences, experiences], [identity] will be filtered out
      const layers = intersectLayers(params.layers, allowedLayers);
      if (!layers.length) {
        return { message: 'No layers to extract for requested batch.', processed: 0, results: [] };
      }

      const executor = await MemoryExtractionExecutor.create();

      const results: ExtractionResult[] = [];

      for (const topicId of params.topicIds) {
        const extracted = await context.run(
          `memory:user-memory:extract:users:${userId}:topics:${topicId}:extract-topic-${layers.join(
            '-',
          )}`,
          () =>
            executor.extractTopic({
              forceAll: params.forceAll,
              forceTopics: params.forceTopics,
              from: params.from,
              layers,
              source: MemorySourceType.ChatTopic,
              to: params.to,
              topicId,
              userId,
            }),
        );

        results.push({ ...extracted, topicId, userId });
      }

      return { processed: results.length, results };
    },
  );

export const cepWorkflow = createLayerWorkflow(CEP_LAYERS);
export const identityWorkflow = createLayerWorkflow(IDENTITY_LAYERS);

export const orchestratorWorkflow = createWorkflow<
  MemoryExtractionPayloadInput,
  {
    nextIdentityCursor: number | null;
    processedCep: number;
    processedIdentity: number;
  }
>(async (context) => {
  console.log('[chat-topic][orchestrator] Starting orchestrator workflow');

  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
  if (!params.userIds.length) {
    return {
      message: 'No user id provided for topic batch.',
      nextIdentityCursor: null,
      processedCep: 0,
      processedIdentity: 0,
    };
  }
  if (!params.topicIds.length) {
    return {
      message: 'No topic ids provided for extraction.',
      nextIdentityCursor: null,
      processedCep: 0,
      processedIdentity: 0,
    };
  }
  if (!params.sources.includes(MemorySourceType.ChatTopic)) {
    return {
      message: 'Source not supported in topic batch.',
      nextIdentityCursor: null,
      processedCep: 0,
      processedIdentity: 0,
    };
  }

  const userId = params.userIds[0];
  const topicIds = params.topicIds;

  let cepIndex = 0;
  let identityIndex = params.identityCursor ?? 0;

  const invokeCep = (batch: string[], batchIndex: number) =>
    context.invoke(`memory:user-memory:extract:users:${userId}:topics:cep-batch:${batchIndex}`, {
      body: { ...params, identityCursor: undefined, topicIds: batch, userId, userIds: [userId] },
      flowControl: { key: `memory:user:${userId}:cep`, parallelism: 1 },
      workflow: cepWorkflow,
    });

  const invokeIdentity = (topicId: string, pointer: number) =>
    context.invoke(`memory:user-memory:extract:users:${userId}:topics:identity:${pointer}`, {
      body: {
        ...params,
        identityCursor: undefined,
        topicIds: [topicId],
        userId,
        userIds: [userId],
      },
      flowControl: { key: `memory:user:${userId}:identity`, parallelism: 1 },
      workflow: identityWorkflow,
    });

  while (cepIndex < topicIds.length || identityIndex < topicIds.length) {
    if (cepIndex < topicIds.length) {
      const cepBatch = topicIds.slice(cepIndex, cepIndex + CEP_PARALLEL_BATCH_SIZE);
      const tasks: Promise<any>[] = [invokeCep(cepBatch, cepIndex)];

      const shouldRunIdentity = identityIndex < cepIndex && identityIndex < topicIds.length;
      if (shouldRunIdentity) {
        tasks.push(invokeIdentity(topicIds[identityIndex], identityIndex));
      }

      await Promise.all(tasks);

      cepIndex += cepBatch.length;
      if (shouldRunIdentity) {
        identityIndex += 1;
      }
    } else if (identityIndex < topicIds.length) {
      await invokeIdentity(topicIds[identityIndex], identityIndex);
      identityIndex += 1;
    } else {
      break;
    }
  }

  return {
    nextIdentityCursor: identityIndex >= topicIds.length ? null : identityIndex,
    processedCep: Math.min(cepIndex, topicIds.length),
    processedIdentity: identityIndex - (params.identityCursor ?? 0),
  };
});

// Explicitly set workflow ids to ensure context.invoke works
cepWorkflow.workflowId = TOPIC_WORKFLOW_NAMES.cep;
identityWorkflow.workflowId = TOPIC_WORKFLOW_NAMES.identity;
orchestratorWorkflow.workflowId = TOPIC_WORKFLOW_NAMES.orchestrator;
