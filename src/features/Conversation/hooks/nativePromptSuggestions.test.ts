import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { supportsNativePromptSuggestions } from './nativePromptSuggestions';

const desktop = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get isDesktop() {
    return desktop.isDesktop;
  },
}));

const claudeCode = (config: Partial<LobeAgentAgencyConfig> = {}) =>
  ({
    heterogeneousProvider: { type: 'claude-code' },
    ...config,
  }) as LobeAgentAgencyConfig;

describe('supportsNativePromptSuggestions', () => {
  afterEach(() => {
    desktop.isDesktop = true;
  });

  it.each([undefined, 'local'] as const)('is true on desktop for target %s', (executionTarget) => {
    expect(supportsNativePromptSuggestions(claudeCode({ executionTarget }), false)).toBe(true);
  });

  it.each(['device', 'sandbox'] as const)('is false for a gateway %s run', (executionTarget) => {
    expect(
      supportsNativePromptSuggestions(
        claudeCode({ boundDeviceId: 'device-a', executionTarget }),
        false,
      ),
    ).toBe(false);
  });

  it('is false for an unmerged workspace config, which cannot run on this client', () => {
    expect(supportsNativePromptSuggestions(claudeCode({ executionTarget: 'local' }), true)).toBe(
      false,
    );
  });

  it('is false on the web', () => {
    desktop.isDesktop = false;
    expect(supportsNativePromptSuggestions(claudeCode({ executionTarget: 'local' }), false)).toBe(
      false,
    );
  });

  it('is false for another CLI agent', () => {
    expect(
      supportsNativePromptSuggestions(
        { executionTarget: 'local', heterogeneousProvider: { type: 'codex' } },
        false,
      ),
    ).toBe(false);
  });
});
