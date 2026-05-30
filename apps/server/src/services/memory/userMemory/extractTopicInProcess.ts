import debug from 'debug';

import { LayersEnum, MemorySourceType } from '@/types/userMemory';

import { type MemoryExtractionExecutor } from './extract';

const log = debug('lobe-server:memory:user-memory:in-process');

export const CEPA_LAYERS = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];
export const IDENTITY_LAYERS = [LayersEnum.Identity];

export async function extractTopicInProcess(params: {
  executor: MemoryExtractionExecutor;
  topicId: string;
  userId: string;
  asyncTaskId?: string;
  forceAll: boolean;
  forceTopics: boolean;
  from?: Date;
  to?: Date;
  userInitiated: boolean;
  checkCancellation: () => Promise<boolean>;
}): Promise<{ cepaResult: any; identityResult: any; cancelled: boolean }> {
  const { executor, topicId, userId, asyncTaskId, forceAll, forceTopics, from, to, userInitiated, checkCancellation } =
    params;

  // Check for cancellation before CEPA extraction
  if (asyncTaskId) {
    const cancelled = await checkCancellation();
    if (cancelled) {
      log('task cancelled, stopping');
      return { cancelled: true, cepaResult: null, identityResult: null };
    }
  }

  // Process CEPA layers (errors propagate to caller)
  const cepaResult = await executor.extractTopic({
    asyncTaskId,
    forceAll,
    forceTopics,
    from,
    layers: CEPA_LAYERS,
    reportProgress: false,
    skipTaskStatusUpdate: true,
    source: MemorySourceType.ChatTopic,
    to,
    topicId,
    userId,
    userInitiated,
  });

  // Check for cancellation before Identity extraction
  if (asyncTaskId) {
    const cancelled = await checkCancellation();
    if (cancelled) {
      log('task cancelled before identity extraction, stopping');
      return { cancelled: true, cepaResult, identityResult: null };
    }
  }

  // Process Identity layer (errors propagate to caller)
  const identityResult = await executor.extractTopic({
    asyncTaskId,
    forceAll,
    forceTopics,
    from,
    layers: IDENTITY_LAYERS,
    reportProgress: false,
    skipTaskStatusUpdate: true,
    source: MemorySourceType.ChatTopic,
    to,
    topicId,
    userId,
    userInitiated,
  });

  return { cancelled: false, cepaResult, identityResult };
}
