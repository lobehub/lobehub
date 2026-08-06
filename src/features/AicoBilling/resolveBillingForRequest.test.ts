import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertAicoBillingAllowsChat,
  resolveAicoBillingForRequest,
} from './resolveBillingForRequest';
import { setAicoBillingContext, useAicoBillingStore } from './store';

const getMyBillingSources = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aicoBilling: {
      getMyBillingSources: { query: (...args: unknown[]) => getMyBillingSources(...args) },
    },
  },
}));

const fundedSources = {
  preferredBillingSource: 'organization' as const,
  preferredOrganizationId: 'org-9',
  sources: [
    {
      hasManagedKey: true,
      isActive: true,
      remainingMicroUsd: '0',
      remainingUsd: '0.000000',
      source: 'personal' as const,
    },
    {
      hasManagedKey: true,
      isActive: true,
      organizationId: 'org-9',
      organizationName: 'Nine',
      remainingMicroUsd: '1000000',
      remainingUsd: '1.000000',
      renewalBlocked: false,
      source: 'organization' as const,
    },
  ],
  trialActive: false,
  trialAvailable: false,
};

describe('resolveAicoBillingForRequest', () => {
  beforeEach(() => {
    useAicoBillingStore.setState({ context: null, hydrated: false });
    getMyBillingSources.mockReset();
  });

  it('skips non-managed providers', async () => {
    await expect(resolveAicoBillingForRequest('openai')).resolves.toBeUndefined();
    expect(getMyBillingSources).not.toHaveBeenCalled();
  });

  it('returns cached context for aico/openrouter without refetch', async () => {
    setAicoBillingContext({ source: 'personal' });
    await expect(resolveAicoBillingForRequest('aico')).resolves.toEqual({ source: 'personal' });
    await expect(resolveAicoBillingForRequest('openrouter')).resolves.toEqual({
      source: 'personal',
    });
    expect(getMyBillingSources).not.toHaveBeenCalled();
  });

  it('loads preference when cache is empty', async () => {
    getMyBillingSources.mockResolvedValue(fundedSources);

    await expect(resolveAicoBillingForRequest('aico')).resolves.toEqual({
      organizationId: 'org-9',
      source: 'organization',
    });
    expect(useAicoBillingStore.getState().context).toEqual({
      organizationId: 'org-9',
      source: 'organization',
    });
  });
});

describe('assertAicoBillingAllowsChat', () => {
  beforeEach(() => {
    useAicoBillingStore.setState({ context: null, hydrated: false });
    getMyBillingSources.mockReset();
  });

  it('skips non-managed providers', async () => {
    await expect(assertAicoBillingAllowsChat('openai')).resolves.toBeUndefined();
    expect(getMyBillingSources).not.toHaveBeenCalled();
  });

  it('allows funded selected org source', async () => {
    setAicoBillingContext({ organizationId: 'org-9', source: 'organization' });
    getMyBillingSources.mockResolvedValue(fundedSources);

    await expect(assertAicoBillingAllowsChat('aico')).resolves.toEqual({
      organizationId: 'org-9',
      source: 'organization',
    });
  });

  it('throws PERSONAL_FUNDS_UNAVAILABLE for empty personal without trial', async () => {
    setAicoBillingContext({ source: 'personal' });
    getMyBillingSources.mockResolvedValue(fundedSources);

    await expect(assertAicoBillingAllowsChat('aico')).rejects.toThrow('PERSONAL_FUNDS_UNAVAILABLE');
  });

  it('allows empty personal when trial is active', async () => {
    setAicoBillingContext({ source: 'personal' });
    getMyBillingSources.mockResolvedValue({
      ...fundedSources,
      trialActive: true,
    });

    await expect(assertAicoBillingAllowsChat('aico')).resolves.toEqual({ source: 'personal' });
  });
});
