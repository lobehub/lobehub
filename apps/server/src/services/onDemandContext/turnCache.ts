import { hashContent } from '@lobechat/context-engine/onDemand';
import type { OnDemandRetrievalBatch } from '@lobechat/types';

export interface OnDemandRetrievalCache {
  batch: OnDemandRetrievalBatch;
  messageKey: string;
}

export const buildOnDemandRetrievalTurnKey = (params: {
  currentUserMessage: string;
  messageId?: string;
  messageIndex: number;
}): string =>
  [
    String(params.messageIndex),
    params.messageId ?? 'anonymous',
    hashContent(params.currentUserMessage),
  ].join(':');

/**
 * One retrieval per user turn. Tool steps keep the same current user message
 * and reuse the batch; a new user message changes the id/index/hash key.
 */
export const getOrLoadOnDemandRetrieval = async (params: {
  cache?: OnDemandRetrievalCache;
  currentUserMessage: string;
  load: () => Promise<OnDemandRetrievalBatch>;
  messageId?: string;
  messageIndex: number;
}): Promise<OnDemandRetrievalCache> => {
  const messageKey = buildOnDemandRetrievalTurnKey(params);
  if (params.cache?.messageKey === messageKey) return params.cache;

  return { batch: await params.load(), messageKey };
};
