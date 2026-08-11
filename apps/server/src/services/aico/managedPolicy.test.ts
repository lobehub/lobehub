import { describe, expect, it } from 'vitest';

import { parseAicoBillingContext } from './billingContext';
import { AicoManagedPolicy, AicoManagedPolicyError } from './managedPolicy';

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
    expect(parseAicoBillingContext({ source: 'organization', organizationId: 'org_1' })).toEqual({
      organizationId: 'org_1',
      source: 'organization',
    });
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

  it('OR-003: authorize requires modelId for managed providers', async () => {
    const policy = new AicoManagedPolicy({} as any, async () => null);
    await expect(
      policy.authorize({ billing: { source: 'personal' }, userId: 'u1' }),
    ).rejects.toMatchObject({ code: 'MODEL_ID_REQUIRED' });
    await expect(
      policy.authorize({ billing: { source: 'personal' }, modelId: '   ', userId: 'u1' }),
    ).rejects.toMatchObject({ code: 'MODEL_ID_REQUIRED' });
  });
});
