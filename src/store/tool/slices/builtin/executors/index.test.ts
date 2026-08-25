import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import {
  WebOnboardingApiName,
  WebOnboardingIdentifier,
} from '@lobechat/builtin-tool-web-onboarding';
import { describe, expect, it, vi } from 'vitest';

import {
  getApiNamesForIdentifier,
  getRegisteredIdentifiers,
  hasExecutor,
  invokeExecutor,
  registerBuiltinToolExecutors,
} from './index';

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
  it('does not register executors as an import side effect', () => {
    expect(getRegisteredIdentifiers()).toEqual([]);
  });

  it('registers web onboarding executor APIs explicitly', async () => {
    await registerBuiltinToolExecutors();

    await expect(
      hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.saveUserQuestion),
    ).resolves.toBe(true);
    await expect(
      hasExecutor(WebOnboardingIdentifier, WebOnboardingApiName.finishOnboarding),
    ).resolves.toBe(true);
    expect(getApiNamesForIdentifier(WebOnboardingIdentifier)).toEqual(
      Object.values(WebOnboardingApiName),
    );
  }, 30_000);

  it('registers multimodal understanding executor APIs', async () => {
    await registerBuiltinToolExecutors();

    await expect(hasExecutor(LobeAgentIdentifier, LobeAgentApiName.analyzeMedia)).resolves.toBe(
      true,
    );
  }, 30_000);

  it('registers the hook-only Grok Build executor without exposing invokable APIs', async () => {
    await registerBuiltinToolExecutors();

    expect(getRegisteredIdentifiers()).toContain('grok-build');
    await expect(hasExecutor('grok-build', 'execute')).resolves.toBe(false);
    expect(getApiNamesForIdentifier('grok-build')).toEqual([]);
  }, 30_000);

  it('rejects nested sub-agent execution', async () => {
    const subAgentRun = vi.fn();
    const baseContext = {
      isSubAgent: true,
      messageId: 'tool-message-id',
      subAgent: { run: subAgentRun },
    };

    await expect(
      invokeExecutor(
        LobeAgentIdentifier,
        LobeAgentApiName.callSubAgent,
        { description: 'Nested work', instruction: 'Do nested work' },
        baseContext,
      ),
    ).resolves.toMatchObject({
      error: { type: 'NestedSubAgentNotAllowed' },
      success: false,
    });

    expect(subAgentRun).not.toHaveBeenCalled();
  }, 30_000);
});
