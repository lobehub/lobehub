import { mutate } from '@/libs/swr';

import { AICO_BILLING_SOURCES_SWR_KEY, AICO_MY_WALLET_SWR_KEY } from './cacheKeys';
import type { AicoBillingContext, AicoBillingSourcesResponse } from './types';

const BILLING_RECONCILE_DELAY_MS = 1500;

interface RefreshAicoBillingBalanceOptions {
  billingContext?: AicoBillingContext;
  costUsd?: number;
}

const applyOptimisticDebit = (
  data: AicoBillingSourcesResponse | undefined,
  billingContext: AicoBillingContext,
  costMicroUsd: number,
): AicoBillingSourcesResponse | undefined => {
  if (!data) return data;

  return {
    ...data,
    sources: data.sources.map((source) => {
      const isSelected =
        billingContext.source === 'personal'
          ? source.source === 'personal'
          : source.source === 'organization' &&
            source.organizationId === billingContext.organizationId;
      if (!isSelected) return source;

      const remainingMicroUsd = Number(source.remainingMicroUsd);
      if (!Number.isSafeInteger(remainingMicroUsd)) return source;

      const nextRemainingMicroUsd = Math.max(0, remainingMicroUsd - costMicroUsd);

      return {
        ...source,
        remainingMicroUsd: String(nextRemainingMicroUsd),
        remainingUsd: (nextRemainingMicroUsd / 1_000_000).toFixed(6),
      };
    }),
  };
};

/**
 * Keep every visible Aico balance coherent after managed usage.
 *
 * Chat can apply the stream's reported cost immediately, then both caches are
 * revalidated against OpenRouter/server state. Async generation has no client-side
 * cost until completion, so callers trigger the authoritative refresh when the
 * generation task reaches a terminal state.
 */
export const refreshAicoBillingBalance = async (
  options: RefreshAicoBillingBalanceOptions = {},
): Promise<void> => {
  const { billingContext, costUsd } = options;
  const costMicroUsd = Math.round((costUsd ?? 0) * 1_000_000);
  const revalidate = async () => {
    await Promise.allSettled([
      mutate(AICO_BILLING_SOURCES_SWR_KEY),
      mutate(AICO_MY_WALLET_SWR_KEY),
    ]);
  };

  if (billingContext && Number.isSafeInteger(costMicroUsd) && costMicroUsd > 0) {
    await mutate(
      AICO_BILLING_SOURCES_SWR_KEY,
      (data: AicoBillingSourcesResponse | undefined) =>
        applyOptimisticDebit(data, billingContext, costMicroUsd),
      { revalidate: false },
    );

    // OpenRouter may expose the previous remaining amount for a short window
    // after its stream closes. Keep the optimistic value stable, then reconcile
    // once settlement has had a chance to land instead of snapping backward.
    setTimeout(() => void revalidate(), BILLING_RECONCILE_DELAY_MS);
    return;
  }

  await revalidate();
};
