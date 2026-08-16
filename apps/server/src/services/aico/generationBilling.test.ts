import { describe, expect, it } from 'vitest';

import { resolveManagedGenerationBilling, toManagedGenerationModelId } from './generationBilling';
import { AicoManagedPolicyError } from './managedPolicy';

describe('toManagedGenerationModelId', () => {
  it('strips the synthesized :image suffix', () => {
    expect(toManagedGenerationModelId('google/gemini-3.1-flash-image-preview:image')).toBe(
      'google/gemini-3.1-flash-image-preview',
    );
  });

  it('leaves chat model ids unchanged', () => {
    expect(toManagedGenerationModelId('google/gemini-3.1-flash-image-preview')).toBe(
      'google/gemini-3.1-flash-image-preview',
    );
  });
});

describe('resolveManagedGenerationBilling', () => {
  it('rejects direct (BYOK) providers', () => {
    expect(() =>
      resolveManagedGenerationBilling({ aicoBilling: { source: 'personal' }, provider: 'google' }),
    ).toThrow(AicoManagedPolicyError);
    try {
      resolveManagedGenerationBilling({ aicoBilling: { source: 'personal' }, provider: 'google' });
    } catch (error) {
      expect(error).toBeInstanceOf(AicoManagedPolicyError);
      expect((error as AicoManagedPolicyError).code).toBe('DIRECT_PROVIDER_NOT_ALLOWED');
    }
  });

  it('requires an explicit billing context for managed providers', () => {
    expect(() =>
      resolveManagedGenerationBilling({ aicoBilling: undefined, provider: 'openrouter' }),
    ).toThrow(/BILLING_CONTEXT_REQUIRED/);
  });

  it('accepts personal billing on openrouter/aico', () => {
    expect(
      resolveManagedGenerationBilling({ aicoBilling: { source: 'personal' }, provider: 'aico' }),
    ).toEqual({ source: 'personal' });
    expect(
      resolveManagedGenerationBilling({
        aicoBilling: { organizationId: 'org_1', source: 'organization' },
        provider: 'openrouter',
      }),
    ).toEqual({ organizationId: 'org_1', source: 'organization' });
  });
});
