import { z } from 'zod';

import { LayersEnum, MemorySourceType } from '@/types/userMemory';

const SOURCE_ALIAS_MAP: Record<string, MemorySourceType> = {
  benchmark_locomo: MemorySourceType.BenchmarkLocomo,
  chatTopic: MemorySourceType.ChatTopic,
  chatTopics: MemorySourceType.ChatTopic,
  chat_topic: MemorySourceType.ChatTopic,
};

const LAYER_ALIAS = new Set<LayersEnum>([
  LayersEnum.Activity,
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Identity,
  LayersEnum.Preference,
]);

export interface MemoryExtractionWorkflowCursor {
  createdAt: string;
  id: string;
}

export interface TopicWorkflowCursor extends MemoryExtractionWorkflowCursor {
  userId: string;
}

export interface MemoryExtractionHourlyWorkflowPayload {
  baseUrl?: string;
  cursor?: MemoryExtractionWorkflowCursor;
  dryRun?: boolean;
  hourlyTaskId?: string;
}

export interface MemoryExtractionNormalizedPayload {
  asyncTaskId?: string;
  baseUrl: string;
  dryRun: boolean;
  forceAll: boolean;
  forceTopics: boolean;
  from?: Date;
  hourlyTaskId?: string;
  identityCursor: number;
  layers: LayersEnum[];
  /**
   * - `workflow` depends on Upstash Workflows to process the extraction asynchronously.
   * - `direct` processes the extraction within the webhook request itself.
   */
  mode: 'workflow' | 'direct';
  sourceIds?: string[];
  sources: MemorySourceType[];
  to?: Date;
  topicCursor?: TopicWorkflowCursor;
  topicFanoutCount: number;
  topicIds: string[];
  userCursor?: MemoryExtractionWorkflowCursor;
  userId?: string;
  userIds: string[];
  userInitiated?: boolean;
  workspaceId?: string;
}

export const memoryExtractionPayloadSchema = z.object({
  asyncTaskId: z.string().uuid().optional(),
  baseUrl: z.string().url().optional(),
  dryRun: z.boolean().optional(),
  forceAll: z.boolean().optional(),
  forceTopics: z.boolean().optional(),
  fromDate: z.coerce.date().optional(),
  hourlyTaskId: z.string().uuid().optional(),
  identityCursor: z.coerce.number().int().nonnegative().optional(),
  layers: z.array(z.nativeEnum(LayersEnum)).optional(),
  mode: z.enum(['workflow', 'direct']).optional(),
  sourceIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  toDate: z.coerce.date().optional(),
  topicCursor: z
    .object({
      createdAt: z.string(),
      id: z.string(),
      userId: z.string(),
    })
    .optional(),
  // Running count of topics already fanned out for this user in the current pagination chain.
  // Used by process-user-topics to enforce a hard per-user, per-run fan-out ceiling.
  topicFanoutCount: z.coerce.number().int().nonnegative().optional(),
  topicIds: z.array(z.string()).optional(),
  userCursor: z
    .object({
      createdAt: z.string(),
      id: z.string(),
    })
    .optional(),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  userInitiated: z.boolean().optional(),
  workspaceId: z.string().optional(),
});

export type MemoryExtractionPayloadInput = z.infer<typeof memoryExtractionPayloadSchema>;

const normalizeSources = (sources?: string[]): MemorySourceType[] => {
  if (!sources) return [];

  const normalized = sources
    .map((source) => SOURCE_ALIAS_MAP[source as keyof typeof SOURCE_ALIAS_MAP])
    .filter(Boolean) as MemorySourceType[];

  return Array.from(new Set(normalized));
};

const normalizeLayers = (layers?: string[]): LayersEnum[] => {
  if (!layers) return [];

  const normalized = layers
    .map((layer) => layer.toLowerCase() as LayersEnum)
    .filter((layer) => LAYER_ALIAS.has(layer));

  return Array.from(new Set(normalized));
};

export const normalizeMemoryExtractionPayload = (
  payload: MemoryExtractionPayloadInput,
  fallbackBaseUrl?: string,
): MemoryExtractionNormalizedPayload => {
  const parsed = memoryExtractionPayloadSchema.parse(payload);
  const baseUrl = parsed.baseUrl || fallbackBaseUrl;
  if (!baseUrl) throw new Error('Missing baseUrl for workflow trigger');

  return {
    asyncTaskId: parsed.asyncTaskId,
    baseUrl,
    dryRun: parsed.dryRun ?? false,
    forceAll: parsed.forceAll ?? false,
    forceTopics: parsed.forceTopics ?? false,
    from: parsed.fromDate,
    hourlyTaskId: parsed.hourlyTaskId,
    identityCursor: parsed.identityCursor ?? 0,
    layers: normalizeLayers(parsed.layers),
    mode: parsed.mode ?? 'workflow',
    sourceIds: Array.from(new Set(parsed.sourceIds || [])).filter(Boolean),
    sources: normalizeSources(parsed.sources),
    to: parsed.toDate,
    topicCursor: parsed.topicCursor,
    topicFanoutCount: parsed.topicFanoutCount ?? 0,
    topicIds: Array.from(new Set(parsed.topicIds || [])).filter(Boolean),
    userCursor: parsed.userCursor,
    userId: parsed.userId ?? parsed.userIds?.[0],
    userIds: Array.from(
      new Set([...(parsed.userIds || []), ...(parsed.userId ? [parsed.userId] : [])]),
    ).filter(Boolean),
    userInitiated: parsed.userInitiated ?? false,
    workspaceId: parsed.workspaceId,
  };
};

export type UserTopicWorkflowPayload = MemoryExtractionPayloadInput;

export interface TopicBatchWorkflowPayload extends MemoryExtractionPayloadInput {
  topicIds: string[];
  userId: string;
}

export const buildWorkflowPayloadInput = (
  payload: MemoryExtractionNormalizedPayload,
): MemoryExtractionPayloadInput => ({
  asyncTaskId: payload.asyncTaskId,
  baseUrl: payload.baseUrl,
  dryRun: payload.dryRun,
  forceAll: payload.forceAll,
  forceTopics: payload.forceTopics,
  fromDate: payload.from,
  hourlyTaskId: payload.hourlyTaskId,
  identityCursor: payload.identityCursor,
  layers: payload.layers,
  mode: payload.mode,
  sourceIds: payload.sourceIds,
  sources: payload.sources,
  toDate: payload.to,
  topicCursor: payload.topicCursor,
  topicFanoutCount: payload.topicFanoutCount,
  topicIds: payload.topicIds,
  userCursor: payload.userCursor,
  userId: payload.userId ?? payload.userIds[0],
  userIds: payload.userIds,
  userInitiated: payload.userInitiated,
  workspaceId: payload.workspaceId,
});
