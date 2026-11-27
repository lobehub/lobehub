import { useEffect, useMemo, useState } from 'react';

import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useComposerDraftBus } from '../../composerDraftBus';
import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { useEffectiveConversationModelConfig } from '../../store/utils/effectiveModel';
import { isMainComposer } from './isMainComposer';
import type { NextReplyCostEstimate, PromptCacheSnapshot } from './promptCacheState';
import {
  collectDisplayedMessageIds,
  estimateNextReplyCost,
  getPromptCacheSnapshot,
  isIdleCacheNoticeworthy,
} from './promptCacheState';

/** `setTimeout` stores its delay as a signed 32-bit integer; a longer one fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface PromptCacheState {
  /** Context window of the conversation's model, when its card states one. */
  contextWindowTokens?: number;
  /** Next-reply cost with a warm and with an expired cache, priced at what the user pays. */
  cost?: NextReplyCostEstimate;
  /** The provider has most likely dropped the cache the latest reply left. */
  expired: boolean;
  snapshot: PromptCacheSnapshot;
}

/**
 * The prompt cache the conversation's latest reply left, re-evaluated when it expires.
 *
 * `undefined` when the latest reply did not ask for caching, or when the conversation's model has
 * changed since: another model never shares the old model's cache, so the snapshot says nothing
 * about the next reply.
 */
export const usePromptCacheState = (): PromptCacheState | undefined => {
  const dbMessages = useConversationStore(dataSelectors.dbMessages);
  const displayMessages = useConversationStore(dataSelectors.displayMessages);
  const context = useConversationStore((s) => s.context);
  const { model, provider } = useEffectiveConversationModelConfig(context);
  const snapshot = useMemo(
    () => getPromptCacheSnapshot(dbMessages, collectDisplayedMessageIds(displayMessages)),
    [dbMessages, displayMessages],
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!snapshot) return;

    const current = Date.now();
    setNow(current);
    if (current >= snapshot.expiresAt) return;

    // One timer to the expiry instead of a ticking clock: nothing on screen counts down.
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(snapshot.expiresAt - current + 1000, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(timer);
  }, [snapshot]);

  const sameModel =
    !!snapshot &&
    !!model &&
    snapshot.model === model &&
    (!snapshot.provider || !provider || snapshot.provider === provider);

  const modelCard = useAiInfraStore((s) =>
    sameModel && model && provider ? aiModelSelectors.getModelCard(model, provider)(s) : undefined,
  );
  const resolvePricing = useBusinessModelPricing();
  const pricing = modelCard
    ? resolvePricing({ model, pricing: modelCard.pricing, provider })
    : undefined;

  const cost = useMemo(
    () =>
      snapshot && pricing
        ? estimateNextReplyCost(snapshot, pricing, modelCard?.maxOutput)
        : undefined,
    [modelCard?.maxOutput, pricing, snapshot],
  );

  const expired = !!snapshot && now >= snapshot.expiresAt;
  const contextWindowTokens = modelCard?.contextWindowTokens;

  return useMemo(
    () => (snapshot && sameModel ? { contextWindowTokens, cost, expired, snapshot } : undefined),
    [contextWindowTokens, cost, expired, sameModel, snapshot],
  );
};

export interface IdleCacheNotice {
  cost: NextReplyCostEstimate;
  snapshot: PromptCacheSnapshot;
}

/**
 * The idle prompt-cache notice to show above the composer, or `undefined`.
 *
 * It shows once the latest reply's cache has expired and re-reading the conversation costs enough
 * more than a warm reply (see {@link isIdleCacheNoticeworthy}). It stays hidden while a reply is
 * generating, outside the main chat composer (see {@link isMainComposer}), for external agents (whose runtimes own their own
 * cache), and after the user closed it for this reply.
 */
export const useIdleCacheNotice = (): IdleCacheNotice | undefined => {
  const cacheState = usePromptCacheState();
  const context = useConversationStore((s) => s.context);
  const [isGenerating, isInputLoading, dismissedId] = useConversationStore((s) => [
    messageStateSelectors.isAIGenerating(s),
    messageStateSelectors.isInputLoading(s),
    s.dismissedIdleCacheNoticeId,
  ]);
  const busAttached = useComposerDraftBus((s) => s.attached);
  const busContextKey = useComposerDraftBus((s) => s.contextKey);
  const agentId = context.subAgentId ?? context.agentId;
  const isHeterogeneousAgent = useAgentStore((s) =>
    agentByIdSelectors.isAgentHeterogeneousById(agentId)(s),
  );
  if (!cacheState?.expired || !cacheState.cost) return;
  if (isGenerating || isInputLoading || isHeterogeneousAgent) return;
  if (!isMainComposer(context, { attached: busAttached, contextKey: busContextKey })) return;
  if (dismissedId === cacheState.snapshot.messageId) return;
  if (
    !isIdleCacheNoticeworthy(cacheState.snapshot, cacheState.cost, cacheState.contextWindowTokens)
  )
    return;

  return { cost: cacheState.cost, snapshot: cacheState.snapshot };
};
