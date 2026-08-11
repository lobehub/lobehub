import { describe, expect, it, vi } from 'vitest';

import type { AicoBillingSource } from '@/features/AicoBilling/types';

import {
  resolveManagedKeyErrorDescription,
  shouldShowManagedKeyTrialActions,
} from './resolveManagedKeyErrorDescription';

const orgSource: AicoBillingSource = {
  hasManagedKey: true,
  isActive: true,
  organizationId: 'org-1',
  organizationName: 'Acme',
  remainingMicroUsd: '5000000',
  remainingUsd: '5.000000',
  renewalBlocked: false,
  source: 'organization',
};

const t = vi.fn((key: string) => key);

describe('resolveManagedKeyErrorDescription', () => {
  it('prefers server Aico error code over gate fallback', () => {
    expect(
      resolveManagedKeyErrorDescription({
        activeSource: orgSource,
        blockReason: null,
        serverErrorCode: 'MEMBER_BUDGET_UNFUNDED',
        showTrialCta: false,
        t,
      }),
    ).toBe('errors.MEMBER_BUDGET_UNFUNDED');
  });

  it('uses org unfunded copy when org is active and gate is open', () => {
    expect(
      resolveManagedKeyErrorDescription({
        activeSource: orgSource,
        blockReason: null,
        showTrialCta: false,
        t,
      }),
    ).toBe('errors.MEMBER_BUDGET_UNFUNDED');
  });

  it('uses personal trial copy only for personal source', () => {
    expect(
      resolveManagedKeyErrorDescription({
        activeSource: {
          hasManagedKey: false,
          isActive: true,
          remainingMicroUsd: '0',
          remainingUsd: '0.000000',
          source: 'personal',
        },
        blockReason: 'PERSONAL_FUNDS_UNAVAILABLE',
        showTrialCta: true,
        t,
      }),
    ).toBe('billing.fundsBlocked.descWithTrial');
  });
});

describe('shouldShowManagedKeyTrialActions', () => {
  it('hides trial actions on org billing source', () => {
    expect(
      shouldShowManagedKeyTrialActions({
        activeSource: orgSource,
        blockReason: 'PERSONAL_FUNDS_UNAVAILABLE',
        showTrialCta: true,
      }),
    ).toBe(false);
  });
});
