import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';

import { chatService } from './index';
import * as mechaModule from './mecha';
import { type ResolvedAgentConfig } from './mecha';

vi.mock('../_auth', () => ({
  createHeaderWithAuth: vi.fn(async ({ headers }: { headers: Record<string, string> }) => headers),
}));

const resolvedAgentConfig = {
  agentConfig: { chatConfig: {}, model: 'claude-sonnet-4-6', params: {}, provider: 'anthropic' },
  chatConfig: { searchMode: 'off' },
  enabledManifests: [],
  enabledToolIds: [],
  isBuiltinAgent: false,
  plugins: [],
} as unknown as ResolvedAgentConfig;

const messages = [{ content: 'Hello', role: 'user' }] as UIChatMessage[];

const resolvedModelParams = (contextCachingTTL?: string, requestTTL?: string) =>
  ({
    capabilities: {},
    contextCachingTTL,
    modelHasReasoningExtendParams: false,
    resolvedExtendParams: requestTTL ? { contextCachingTTL: requestTTL } : undefined,
    shouldReplayAssistantReasoning: false,
    stream: true,
  }) as unknown as Awaited<ReturnType<typeof mechaModule.resolveBrowserModelParams>>;

beforeEach(() => {
  vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(
    () => ({ plugins: [], systemRole: '' }) as any,
  );
  vi.spyOn(chatConfigByIdSelectors, 'getChatConfigById').mockReturnValue(
    () => ({ searchMode: 'off' }) as any,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The payload writes the cache breakpoints and context engineering prices the
 * stale-tool-result trim's warmth check; both come from the model's one resolved TTL.
 */
describe('ChatService — prompt-cache TTL', () => {
  it('hands the resolved TTL to both context engineering and the payload', async () => {
    vi.spyOn(mechaModule, 'resolveBrowserModelParams').mockResolvedValue(
      resolvedModelParams('1h', '1h'),
    );
    const contextEngineeringSpy = vi.spyOn(mechaModule, 'contextEngineering').mockResolvedValue([]);

    const prepared = await chatService.buildAssistantMessageContext({
      messages,
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      resolvedAgentConfig,
    });

    expect(contextEngineeringSpy).toHaveBeenCalledWith(
      expect.objectContaining({ contextCachingTTL: '1h' }),
    );
    expect(prepared.params.contextCachingTTL).toBe('1h');
  });

  it('prices a provider without a request TTL by its window, writing nothing', async () => {
    vi.spyOn(mechaModule, 'resolveBrowserModelParams').mockResolvedValue(
      resolvedModelParams('72h'),
    );
    const contextEngineeringSpy = vi.spyOn(mechaModule, 'contextEngineering').mockResolvedValue([]);

    const prepared = await chatService.buildAssistantMessageContext({
      messages,
      model: 'deepseek-v4-pro',
      provider: 'deepseek',
      resolvedAgentConfig,
    });

    expect(contextEngineeringSpy).toHaveBeenCalledWith(
      expect.objectContaining({ contextCachingTTL: '72h' }),
    );
    expect(prepared.params.contextCachingTTL).toBeUndefined();
  });

  it('drops a caller-supplied TTL the resolver did not grant', async () => {
    vi.spyOn(mechaModule, 'resolveBrowserModelParams').mockResolvedValue(
      resolvedModelParams('5m', '5m'),
    );
    const contextEngineeringSpy = vi.spyOn(mechaModule, 'contextEngineering').mockResolvedValue([]);

    const prepared = await chatService.buildAssistantMessageContext({
      contextCachingTTL: '1h',
      messages,
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      resolvedAgentConfig,
    });

    // Context engineering priced the trim with the model's 5m window, so the
    // payload must not write 1h breakpoints behind its back.
    expect(contextEngineeringSpy).toHaveBeenCalledWith(
      expect.objectContaining({ contextCachingTTL: '5m' }),
    );
    expect(prepared.params.contextCachingTTL).toBe('5m');
  });
});
