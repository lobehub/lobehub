import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';

import { AICO_BILLING_SOURCES_SWR_KEY, AICO_MY_WALLET_SWR_KEY } from './cacheKeys';
import { refreshAicoBillingBalance } from './refreshAicoBillingBalance';
import type { AicoBillingSourcesResponse } from './types';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn() }));

const billingSources: AicoBillingSourcesResponse = {
  preferredBillingSource: 'personal',
  preferredOrganizationId: null,
  sources: [
    {
      hasManagedKey: true,
      isActive: true,
      remainingMicroUsd: '2000000',
      remainingUsd: '2.000000',
      source: 'personal',
    },
    {
      hasManagedKey: true,
      isActive: true,
      organizationId: 'org-1',
      organizationName: 'One',
      remainingMicroUsd: '5000000',
      remainingUsd: '5.000000',
      renewalBlocked: false,
      source: 'organization',
    },
  ],
  trialActive: false,
  trialAvailable: false,
};

describe('refreshAicoBillingBalance', () => {
  beforeEach(() => {
    vi.mocked(mutate).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the selected source immediately before authoritative revalidation', async () => {
    vi.useFakeTimers();

    await refreshAicoBillingBalance({ billingContext: { source: 'personal' }, costUsd: 0.25 });

    const optimisticUpdater = vi.mocked(mutate).mock.calls[0][1] as (
      data: AicoBillingSourcesResponse,
    ) => AicoBillingSourcesResponse;
    expect(optimisticUpdater).toBeTypeOf('function');
    expect(optimisticUpdater(billingSources)).toEqual({
      ...billingSources,
      sources: [
        {
          ...billingSources.sources[0],
          remainingMicroUsd: '1750000',
          remainingUsd: '1.750000',
        },
        billingSources.sources[1],
      ],
    });
    expect(mutate).toHaveBeenNthCalledWith(1, AICO_BILLING_SOURCES_SWR_KEY, expect.any(Function), {
      revalidate: false,
    });
    expect(mutate).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();

    expect(mutate).toHaveBeenNthCalledWith(2, AICO_BILLING_SOURCES_SWR_KEY);
    expect(mutate).toHaveBeenNthCalledWith(3, AICO_MY_WALLET_SWR_KEY);
  });

  it('revalidates both balance caches when no optimistic cost is available', async () => {
    await refreshAicoBillingBalance();

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledWith(AICO_BILLING_SOURCES_SWR_KEY);
    expect(mutate).toHaveBeenCalledWith(AICO_MY_WALLET_SWR_KEY);
  });
});
