// @vitest-environment node
import type { ModelRuntime } from '@lobechat/model-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import * as ModelRuntimeModule from '@/server/modules/ModelRuntime';

import { TaskReviewService } from './index';

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = async () => ({
      systemAgent: { topic: { model: 'qwen3:1.7b', provider: 'ollama' } },
    });
  },
}));

const resolveProviderRelay = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay,
}));
// A deployment that can relay (Agent Gateway + Redis).
vi.mock('@/server/modules/AgentRuntime/redis', () => ({ getAgentRuntimeRedisClient: () => ({}) }));
vi.mock('@/server/modules/AgentRuntime/factory', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createStreamEventManager: () => ({ openLlmRelayChannel: vi.fn(), sendLlmExecute: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  resolveProviderRelay.mockReset();
});

const reviewParams = {
  content: 'The task output.',
  judge: {},
  rubrics: [
    {
      config: { criteria: 'Is the output complete?' },
      id: 'r1',
      name: 'complete',
      type: 'llm-rubric' as const,
      weight: 1,
    },
  ],
  taskName: 'Ship it',
};

describe('TaskReviewService with a device-only judge model', () => {
  // The judge (here the topic model on Ollama) only runs on the user's device.
  // A review requested without a browser tab attached must say so, not call
  // the provider from the server.
  it('fails with no_executor when no browser tab is attached', async () => {
    resolveProviderRelay.mockResolvedValue({ runtimeProvider: 'ollama' });
    const init = vi.spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB').mockResolvedValue({
      generateObject: vi.fn().mockResolvedValue({ reason: 'ok', score: 1 }),
    } as unknown as ModelRuntime);
    const service = new TaskReviewService({} as LobeChatDatabase, 'user-1');

    await expect(service.review(reviewParams)).rejects.toMatchObject({
      error: expect.objectContaining({ reason: 'no_executor' }),
      errorType: 'ClientLlmExecutorUnavailable',
    });
    expect(init).not.toHaveBeenCalled();
  });

  it('keeps calling a cloud judge from the server', async () => {
    resolveProviderRelay.mockResolvedValue(undefined);
    const generateObject = vi.fn().mockResolvedValue({ reason: 'ok', score: 1 });
    const init = vi
      .spyOn(ModelRuntimeModule, 'initModelRuntimeFromDB')
      .mockResolvedValue({ generateObject } as unknown as ModelRuntime);
    const service = new TaskReviewService({} as LobeChatDatabase, 'user-1');

    const result = await service.review(reviewParams);

    expect(init).toHaveBeenCalledWith({}, 'user-1', 'ollama', undefined);
    expect(generateObject).toHaveBeenCalled();
    expect(result.passed).toBe(true);
  });
});
