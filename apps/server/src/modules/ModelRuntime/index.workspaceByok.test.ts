// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeFromDB } from './index';

const mocks = vi.hoisted(() => ({
  assertWorkspaceByokAllowed: vi.fn(),
  getAiProviderById: vi.fn(),
}));

vi.mock('@/business/server/workspaceByok', () => ({
  assertWorkspaceByokAllowed: mocks.assertWorkspaceByokAllowed,
}));

vi.mock('@/database/models/aiProvider', () => ({
  AiProviderModel: vi.fn().mockImplementation(() => ({
    getAiProviderById: mocks.getAiProviderById,
  })),
}));

vi.mock('@/server/services/llmGenerationTracing/hook', () => ({
  createLLMGenerationTracingHook: () => undefined,
}));

const db = {} as any;

describe('initModelRuntimeFromDB workspace provider key gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertWorkspaceByokAllowed.mockResolvedValue(undefined);
    mocks.getAiProviderById.mockResolvedValue({ keyVaults: { apiKey: 'sk-own' } });
  });

  it('asks the gate before reading the workspace keys', async () => {
    await initModelRuntimeFromDB(db, 'user-1', 'openai', 'ws-1');

    expect(mocks.assertWorkspaceByokAllowed).toHaveBeenCalledWith({
      provider: 'openai',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });
    expect(mocks.assertWorkspaceByokAllowed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAiProviderById.mock.invocationCallOrder[0],
    );
  });

  it('refuses the runtime with the gate error and never reads the keys', async () => {
    const refusal = { errorType: ChatErrorType.WorkspaceByokNotEnabled, provider: 'openai' };
    mocks.assertWorkspaceByokAllowed.mockRejectedValue(refusal);

    await expect(initModelRuntimeFromDB(db, 'user-1', 'openai', 'ws-1')).rejects.toBe(refusal);
    expect(mocks.getAiProviderById).not.toHaveBeenCalled();
  });

  it('skips the gate in personal mode', async () => {
    await initModelRuntimeFromDB(db, 'user-1', 'openai');

    expect(mocks.assertWorkspaceByokAllowed).not.toHaveBeenCalled();
    expect(mocks.getAiProviderById).toHaveBeenCalled();
  });
});
