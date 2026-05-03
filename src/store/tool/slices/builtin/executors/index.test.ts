import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it, vi } from 'vitest';

import { getApiNamesForIdentifier, hasExecutor } from './index';

vi.hoisted(() => {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});

describe('builtin executor registry', () => {
  it('registers web onboarding executor APIs', () => {
    expect(hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.saveUserQuestion)).toBe(true);
    expect(hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.finishOnboarding)).toBe(true);
    expect(getApiNamesForIdentifier(WebOnboardingIdentifier)).toEqual(
      Object.values(WebOnboardingApiName),
    );
  });

  it('registers visual understanding executor APIs', () => {
    expect(hasExecutor(LobeAgentIdentifier, LobeAgentApiName.analyzeVisualMedia)).toBe(true);
  });
});
