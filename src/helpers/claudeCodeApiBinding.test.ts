import { describe, expect, it } from 'vitest';

import {
  resolveClaudeCodeApiBindingGuard,
  validateClaudeCodeApiBinding,
} from './claudeCodeApiBinding';

const enabledModels = [
  { id: 'claude-fast', providerId: 'anthropic', type: 'chat' },
  { id: 'claude-primary', providerId: 'anthropic', type: 'chat' },
];

describe('validateClaudeCodeApiBinding', () => {
  it('accepts an enabled Anthropic provider and both bound models', () => {
    expect(
      validateClaudeCodeApiBinding({
        apiConfig: {
          model: 'claude-primary',
          providerId: 'anthropic',
          smallFastModel: 'claude-fast',
        },
        enabledModels,
        providerEnabled: true,
        providerSdkType: 'anthropic',
      }),
    ).toBeUndefined();
  });

  it('reports missing configuration', () => {
    expect(
      validateClaudeCodeApiBinding({
        apiConfig: undefined,
        enabledModels,
        providerEnabled: false,
      }),
    ).toEqual({ code: 'configMissing' });
  });

  it('rejects disabled and non-Anthropic providers', () => {
    expect(
      validateClaudeCodeApiBinding({
        apiConfig: { model: 'claude-primary', providerId: 'anthropic' },
        enabledModels,
        providerEnabled: true,
        providerSdkType: 'openai',
      }),
    ).toEqual({ code: 'providerUnavailable', providerId: 'anthropic' });
  });

  it('rejects a stale explicit fast model but treats null as the primary-model default', () => {
    expect(
      validateClaudeCodeApiBinding({
        apiConfig: {
          model: 'claude-primary',
          providerId: 'anthropic',
          smallFastModel: 'removed-fast-model',
        },
        enabledModels,
        providerEnabled: true,
        providerSdkType: 'anthropic',
      }),
    ).toEqual({
      code: 'modelUnavailable',
      model: 'removed-fast-model',
      providerId: 'anthropic',
    });

    expect(
      validateClaudeCodeApiBinding({
        apiConfig: { model: 'claude-primary', providerId: 'anthropic', smallFastModel: null },
        enabledModels,
        providerEnabled: true,
        providerSdkType: 'anthropic',
      }),
    ).toBeUndefined();
  });
});

describe('resolveClaudeCodeApiBindingGuard', () => {
  it('blocks local API sending while provider state loads and when the binding is invalid', () => {
    expect(resolveClaudeCodeApiBindingGuard({ active: true, isReady: false })).toEqual({
      blocked: true,
      error: undefined,
    });

    const error = { code: 'configMissing' } as const;
    expect(resolveClaudeCodeApiBindingGuard({ active: true, error, isReady: true })).toEqual({
      blocked: true,
      error,
    });
  });

  it('does not block other modes or a valid initialized binding', () => {
    expect(resolveClaudeCodeApiBindingGuard({ active: false, isReady: false }).blocked).toBe(false);
    expect(resolveClaudeCodeApiBindingGuard({ active: true, isReady: true }).blocked).toBe(false);
  });
});
