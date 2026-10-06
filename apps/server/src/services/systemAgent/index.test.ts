// @vitest-environment node
import type { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { SystemAgentService } from './index';

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = async () => ({});

    static getInfoForAIGeneration = async () => ({ responseLanguage: 'en-US' });
  },
}));

const resolveProviderRelay = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay,
}));
// A deployment that can relay (Agent Gateway + Redis); one that cannot keeps
// calling the provider from the server.
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => ({}) }));
vi.mock('@/server/modules/AgentRuntime/factory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStreamEventManager: () => ({ openLlmRelayChannel: vi.fn(), sendLlmExecute: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  resolveProviderRelay.mockReset();
});

describe('SystemAgentService.generateTopicTitle', () => {
  it('retains the requested topic identity across calls on a shared runtime', async () => {
    const generateObject = vi.fn().mockResolvedValue({ title: ' Generated title ' });
    vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB').mockResolvedValue({
      generateObject,
    } as unknown as ModelRuntime);
    const service = new SystemAgentService({} as LobeChatDatabase, 'user-1');

    for (const topicId of ['topic-a', 'topic-b', 'topic-a']) {
      expect(
        await service.generateTopicTitle({
          lastAssistantContent: 'Here is the answer.',
          topicId,
          userPrompt: 'A question',
        }),
      ).toBe('Generated title');
      expect(generateObject).toHaveBeenLastCalledWith(
        expect.objectContaining({ schema: expect.objectContaining({ name: 'topic_title' }) }),
        {
          metadata: { topicId, trigger: 'topic_title' },
          tracing: {
            promptVersion: expect.any(String),
            scenario: 'topic_title',
            schemaName: 'topic_title',
            topicId,
          },
        },
      );
    }
  });
});

describe('SystemAgentService with a device-only system agent model', () => {
  // A bot conversation's topic title runs from a webhook: there is no browser
  // tab to relay a local model to. It must fail fast (no provider call from the
  // server) and leave the caller on its default title.
  it('gives up on the topic title at once when no browser tab is attached', async () => {
    resolveProviderRelay.mockResolvedValue({ runtimeProvider: 'ollama' });
    const init = vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = new SystemAgentService({} as LobeChatDatabase, 'user-1');

    const title = await service.generateTopicTitle({
      lastAssistantContent: 'Here is the answer.',
      topicId: 'topic-a',
      userPrompt: 'A question',
    });

    expect(title).toBeNull();
    expect(init).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'SystemAgentService.generateTopicTitle failed:',
      expect.objectContaining({
        error: expect.objectContaining({ reason: 'no_executor' }),
        errorType: 'ClientLlmExecutorUnavailable',
      }),
    );
  });
});
