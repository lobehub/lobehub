import { describe, expect, it } from 'vitest';

import {
  type AicoBillingSource,
  billingContextKey,
  findBillingSource,
  formatRemainingUsd,
  isSameBillingContext,
  preferenceToBillingContext,
} from './types';

const sources: AicoBillingSource[] = [
  {
    hasManagedKey: true,
    isActive: true,
    remainingMicroUsd: '1500000',
    remainingUsd: '1.500000',
    source: 'personal',
  },
  {
    hasManagedKey: true,
    isActive: true,
    organizationId: 'org-1',
    organizationName: 'Acme',
    remainingMicroUsd: '50000000',
    remainingUsd: '50.000000',
    renewalBlocked: false,
    source: 'organization',
  },
  {
    hasManagedKey: false,
    isActive: true,
    organizationId: 'org-2',
    organizationName: 'Beta',
    remainingMicroUsd: '0',
    remainingUsd: '0.000000',
    renewalBlocked: false,
    source: 'organization',
  },
];

describe('AicoBilling types helpers', () => {
  it('preferenceToBillingContext prefers matching org when selected', () => {
    expect(
      preferenceToBillingContext({
        preferredBillingSource: 'organization',
        preferredOrganizationId: 'org-2',
        sources,
      }),
    ).toEqual({ organizationId: 'org-2', source: 'organization' });
  });

  it('preferenceToBillingContext falls back to personal', () => {
    expect(
      preferenceToBillingContext({
        preferredBillingSource: 'personal',
        preferredOrganizationId: null,
        sources,
      }),
    ).toEqual({ source: 'personal' });
  });

  it('preferenceToBillingContext falls back to first org when preferred org is missing', () => {
    expect(
      preferenceToBillingContext({
        preferredBillingSource: 'organization',
        preferredOrganizationId: 'missing',
        sources,
      }),
    ).toEqual({ organizationId: 'org-1', source: 'organization' });
  });

  it('findBillingSource keeps personal and org credits separate', () => {
    expect(findBillingSource(sources, { source: 'personal' })?.remainingUsd).toBe('1.500000');
    expect(
      findBillingSource(sources, { organizationId: 'org-1', source: 'organization' })?.remainingUsd,
    ).toBe('50.000000');
  });

  it('isSameBillingContext / billingContextKey distinguish org ids', () => {
    expect(
      isSameBillingContext(
        { organizationId: 'org-1', source: 'organization' },
        { organizationId: 'org-1', source: 'organization' },
      ),
    ).toBe(true);
    expect(
      isSameBillingContext(
        { organizationId: 'org-1', source: 'organization' },
        { organizationId: 'org-2', source: 'organization' },
      ),
    ).toBe(false);
    expect(billingContextKey({ source: 'personal' })).toBe('personal');
  });

  it('formatRemainingUsd formats decimal strings', () => {
    expect(formatRemainingUsd('12.5')).toBe('$12.5000');
    expect(formatRemainingUsd(undefined)).toBe('$0.0000');
  });
});
