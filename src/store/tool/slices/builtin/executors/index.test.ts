import {
  DashboardApiName,
  DashboardIdentifier,
  LegacyDashboardIdentifier,
} from '@lobechat/builtin-tool-dashboard';
import { LobeAgentApiName, LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
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

  it('runs dashboard calls under the current and the pre-rename identifier', async () => {
    await registerBuiltinToolExecutors();

    for (const identifier of [DashboardIdentifier, LegacyDashboardIdentifier]) {
      await expect(hasExecutor(identifier, DashboardApiName.createDashboard)).resolves.toBe(true);
      await expect(hasExecutor(identifier, DashboardApiName.updateDashboard)).resolves.toBe(true);
    }
    // First test to load every builtin executor; the cold import alone can pass 5s on CI.
  }, 30_000);

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

  it.each([
    ['antigravity', 'run_command'],
    ['grok-build', 'execute'],
  ])(
    'registers the hook-only %s executor without exposing invokable APIs',
    async (identifier, apiName) => {
      await registerBuiltinToolExecutors();

      expect(getRegisteredIdentifiers()).toContain(identifier);
      await expect(hasExecutor(identifier, apiName)).resolves.toBe(false);
      expect(getApiNamesForIdentifier(identifier)).toEqual([]);
    },
    30_000,
  );

  // A web client can be handed a Local System call (a paused desktop call approved in the
  // browser, or a model repeating a call from the topic history). It used to fail with the
  // developer-facing "Ensure the preload exposes invoke" error, which models read as a broken
  // desktop install and retried.
  it('answers a Local System call without the desktop bridge with where it can run', async () => {
    const result = await invokeExecutor(
      LocalSystemIdentifier,
      LocalSystemApiName.readFile,
      { path: '/tmp/notes.md' },
      { messageId: 'tool-message-id' },
    );

    expect(result).toMatchObject({
      error: { type: 'DesktopRuntimeUnavailable' },
      success: false,
    });
    expect(result.content).toMatch(/web browser.*Do not retry.*LobeHub desktop app/);
    expect(result.content).not.toMatch(/Ensure the preload/);
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
