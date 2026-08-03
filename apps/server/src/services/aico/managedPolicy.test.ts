import { describe, expect, it } from 'vitest';

import {
  AicoManagedPolicy,
  AicoManagedPolicyError,
} from './managedPolicy';
import { parseAicoBillingContext } from './billingContext';

describe('explicit billing context + managed policy', () => {
  it('rejects missing / invalid billing context', () => {
    expect(() => parseAicoBillingContext(undefined)).toThrow(/BILLING_CONTEXT/);
    expect(() => parseAicoBillingContext({ source: 'organization' })).toThrow(
      /BILLING_CONTEXT_ORG/,
    );
    expect(() => parseAicoBillingContext({ source: 'wallet' })).toThrow(/BILLING_CONTEXT_INVALID/);
  });

  it('accepts personal and organization shapes', () => {
    expect(parseAicoBillingContext({ source: 'personal' })).toEqual({ source: 'personal' });
    expect(
      parseAicoBillingContext({ source: 'organization', organizationId: 'org_1' }),
    ).toEqual({ organizationId: 'org_1', source: 'organization' });
  });

  it('treats aico and openrouter as managed', () => {
    expect(AicoManagedPolicy.isManagedProvider('aico')).toBe(true);
    expect(AicoManagedPolicy.isManagedProvider('openrouter')).toBe(true);
    expect(AicoManagedPolicy.isManagedProvider('openai')).toBe(false);
  });

  it('AicoManagedPolicyError is fail-closed typed', () => {
    const err = new AicoManagedPolicyError('BILLING_CONTEXT_REQUIRED');
    expect(err.code).toBe('BILLING_CONTEXT_REQUIRED');
    expect(err.name).toBe('AicoManagedPolicyError');
  });
});
