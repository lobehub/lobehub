import type { UIChatMessage } from '@lobechat/types';
import type { AiModelReasoningEffortSettings } from 'model-bank/aiModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { isCanUseFC } from '@/helpers/isCanUseFC';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';

import { chatService } from './index';
import { type ResolvedAgentConfig } from './mecha';

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

const mockCreateHeaderWithAuth = vi.hoisted(() =>
  vi.fn(async ({ headers }: { headers: Record<string, string> }) => headers),
);

// Helper to compute expected date content from SystemDateProvider
const getCurrentDateContent = () => {
  const tz = 'UTC';
  const today = new Date();
  const year = today.toLocaleString('en-US', { timeZone: tz, year: 'numeric' });
  const month = today.toLocaleString('en-US', { month: '2-digit', timeZone: tz });
  const day = today.toLocaleString('en-US', { day: '2-digit', timeZone: tz });
  return `Current date: ${year}-${month}-${day} (${tz})`;
};

/**
 * Default mock resolvedAgentConfig for tests
 */
const createMockResolvedConfig = (overrides?: {
  agentConfig?: Partial<ResolvedAgentConfig['agentConfig']>;
  chatConfig?: Partial<ResolvedAgentConfig['chatConfig']>;
  enabledManifests?: ResolvedAgentConfig['enabledManifests'];
  enabledToolIds?: string[];
  isBuiltinAgent?: boolean;
  plugins?: string[];
  tools?: ResolvedAgentConfig['tools'];
}): ResolvedAgentConfig =>
  ({
    agentConfig: {
      model: DEFAULT_AGENT_CONFIG.model,
      provider: 'openai',
      systemRole: '',
      chatConfig: {},
      params: {},
      tts: {},
      ...overrides?.agentConfig,
    },
    chatConfig: {
      searchMode: 'off',
      ...overrides?.chatConfig,
    },
    enabledManifests: overrides?.enabledManifests ?? [],
    enabledToolIds: overrides?.enabledToolIds ?? [],
    isBuiltinAgent: overrides?.isBuiltinAgent ?? false,
    plugins: overrides?.plugins ?? [],
    tools: overrides?.tools,
  }) as ResolvedAgentConfig;

// Mocking external dependencies
vi.mock('i18next', () => ({
  t: vi.fn((key) => `translated_${key}`),
}));

// 默认设置 isServerMode 为 false
vi.mock(import('@/const/version'), async (importOriginal) => ({
  ...(await importOriginal()),
  isServerMode: false,
  isDeprecatedEdition: true,
  isDesktop: false,
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ some: 'data' })))),
);

// Mock image processing utilities
vi.mock('@lobechat/fetch-sse', async (importOriginal) => {
  const module = await importOriginal();

  return { ...(module as any), getMessageError: vi.fn() };
});
vi.mock('@lobechat/fetch-sse', async (importOriginal) => {
  const module = await importOriginal();
  return {
    ...(module as any),
    fetchSSE: vi.fn(),
  };
});
vi.mock('@lobechat/utils/url', () => ({
  isDesktopLocalStaticServerUrl: vi.fn(),
}));
vi.mock('@lobechat/utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));
vi.mock('@lobechat/utils/uriParser', () => ({
  parseDataUri: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  // Reset all mocks
  vi.clearAllMocks();
  // 清除所有模块的缓存
  vi.resetModules();

  // Vitest 5 keeps the module-mock factory instance across `vi.resetModules()`, so a
  // `mockReturnValue` set inside a test leaks into every later test; restore the default.
  vi.mocked(isCanUseFC).mockReturnValue(true);

  // Default mock for agentSelectors - resolveAgentConfig needs these
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(
    () => ({ plugins: [], systemRole: '' }) as any,
  );
  vi.spyOn(agentSelectors, 'getAgentDocumentsById').mockImplementation(
    (agentId: string) => (state) => state.agentDocumentsMap[agentId],
  );
  vi.spyOn(agentSelectors, 'getAgentSlugById').mockReturnValue(() => undefined);
  vi.spyOn(chatConfigByIdSelectors, 'getChatConfigById').mockReturnValue(
    () => ({ searchMode: 'off' }) as any,
  );
  useAgentStore.setState({ activeAgentId: undefined, agentDocumentsMap: {} } as any);
  useAiInfraStore.setState({ enabledAiModels: [] });
  useChatStore.setState({ activeAgentId: undefined } as any);
});

// mock auth
vi.mock('../_auth', () => ({
  createHeaderWithAuth: mockCreateHeaderWithAuth,
}));

// Mock isCanUseFC to control function calling behavior in tests
vi.mock('@/helpers/isCanUseFC', () => ({
  isCanUseFC: vi.fn(() => true), // Default to true, tests can override
}));

/** Mocks the model card's `settings.reasoningEffort` spec. */
const mockCardReasoningEffort = (reasoningEffort: AiModelReasoningEffortSettings) =>
  vi
    .spyOn(aiModelSelectors, 'getEnabledModelById')
    .mockReturnValue(() => ({ settings: { reasoningEffort } }) as any);
describe('ChatService.createAssistantMessage reasoning effort', () => {
  it('should set reasoning_effort when model supports reasoningEffort and user configures it', async () => {
    const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
    const messages = [{ content: 'Test reasoning effort', role: 'user' }] as UIChatMessage[];

    // Mock aiModelSelectors for extend params support
    vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
    vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);
    mockCardReasoningEffort({ default: 'medium', levels: ['low', 'medium', 'high'] });
    // The user-level model-instance config supplies the effort; the legacy
    // agent chatConfig value below must be ignored by the resolver
    vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({
      reasoningEffort: 'high',
    }));

    await chatService.createAssistantMessage({
      messages,
      model: 'test-model',
      provider: 'test-provider',
      resolvedAgentConfig: createMockResolvedConfig({
        agentConfig: { model: 'test-model', provider: 'test-provider' },
        chatConfig: { reasoningEffort: 'low' },
      }),
    });

    expect(getChatCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_effort: 'high',
      }),
      expect.anything(),
    );
  });

  // LOBE-14979: the control showed "high" while nothing was sent, so MiniMax ran at "max".
  it('sends the card default effort when the user has not picked one', async () => {
    const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
    const messages = [{ content: 'Test default effort', role: 'user' }] as UIChatMessage[];

    vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
    vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);
    mockCardReasoningEffort({ default: 'high', levels: ['low', 'medium', 'high', 'max'] });
    vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({}));

    await chatService.createAssistantMessage({
      messages,
      model: 'MiniMax-M3.1-Flash',
      provider: 'minimax',
      resolvedAgentConfig: createMockResolvedConfig({
        agentConfig: { model: 'MiniMax-M3.1-Flash', provider: 'minimax' },
      }),
    });

    expect(getChatCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning_effort: 'high' }),
      expect.anything(),
    );
  });

  it('should map DeepSeek reasoning effort to enabled thinking', async () => {
    const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
    const messages = [
      { content: 'Test DeepSeek reasoning effort', role: 'user' },
    ] as UIChatMessage[];

    vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
    vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);
    mockCardReasoningEffort({
      controlsThinking: true,
      default: 'high',
      levels: ['none', 'high', 'max'],
    });
    // Reasoning fields are user-level model-instance settings now — agent
    // chatConfig values are ignored by the resolver
    vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({
      reasoningEffort: 'max',
    }));

    await chatService.createAssistantMessage({
      messages,
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      resolvedAgentConfig: createMockResolvedConfig({
        agentConfig: { model: 'deepseek-v4-pro', provider: 'deepseek' },
      }),
    });

    expect(getChatCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_effort: 'max',
        thinking: {
          type: 'enabled',
        },
      }),
      expect.anything(),
    );
  });

  it('should map DeepSeek reasoning effort none to disabled thinking', async () => {
    const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
    const messages = [
      { content: 'Test DeepSeek reasoning disabled', role: 'user' },
    ] as UIChatMessage[];

    vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
    vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);
    mockCardReasoningEffort({
      controlsThinking: true,
      default: 'high',
      levels: ['none', 'high', 'max'],
    });
    vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({
      reasoningEffort: 'none',
    }));

    await chatService.createAssistantMessage({
      messages,
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      resolvedAgentConfig: createMockResolvedConfig({
        agentConfig: { model: 'deepseek-v4-pro', provider: 'deepseek' },
      }),
    });

    expect(getChatCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: {
          type: 'disabled',
        },
      }),
      expect.anything(),
    );
  });

  it('should map Qwen3.8 Max reasoning effort to enabled thinking', async () => {
    const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
    const messages = [
      { content: 'Test Qwen3.8 Max reasoning effort', role: 'user' },
    ] as UIChatMessage[];

    vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
    vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);
    mockCardReasoningEffort({
      controlsThinking: true,
      default: 'medium',
      levels: ['none', 'low', 'medium', 'xhigh'],
    });

    vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({
      reasoningEffort: 'medium',
    }));

    await chatService.createAssistantMessage({
      messages,
      model: 'qwen3.8-max',
      provider: 'qwen',
      resolvedAgentConfig: createMockResolvedConfig({
        agentConfig: { model: 'qwen3.8-max', provider: 'qwen' },
      }),
    });

    expect(getChatCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_effort: 'medium',
        thinking: {
          type: 'enabled',
        },
      }),
      expect.anything(),
    );
  });

  it('should map Qwen3.8 Max reasoning effort none to disabled thinking', async () => {
    const getChatCompletionSpy = vi.spyOn(chatService, 'getChatCompletion');
    const messages = [
      { content: 'Test Qwen3.8 Max reasoning disabled', role: 'user' },
    ] as UIChatMessage[];

    vi.spyOn(aiModelSelectors, 'isModelHasExtendParams').mockReturnValue(() => true);
    vi.spyOn(aiModelSelectors, 'modelExtendParams').mockReturnValue(() => []);
    mockCardReasoningEffort({
      controlsThinking: true,
      default: 'medium',
      levels: ['none', 'low', 'medium', 'xhigh'],
    });

    vi.spyOn(aiModelSelectors, 'modelReasoningConfig').mockReturnValue(() => ({
      reasoningEffort: 'none',
    }));

    await chatService.createAssistantMessage({
      messages,
      model: 'qwen3.8-max',
      provider: 'qwen',
      resolvedAgentConfig: createMockResolvedConfig({
        agentConfig: { model: 'qwen3.8-max', provider: 'qwen' },
      }),
    });

    expect(getChatCompletionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        thinking: {
          type: 'disabled',
        },
      }),
      expect.anything(),
    );
  });
});
