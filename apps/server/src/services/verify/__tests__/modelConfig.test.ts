import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { DEFAULT_MODEL } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isHeterogeneousVerifyProvider, resolveVerifyModelConfig } from '../modelConfig';

const { getAgentModelConfigMock, getBuiltinAgentMock } = vi.hoisted(() => ({
  getAgentModelConfigMock: vi.fn(),
  getBuiltinAgentMock: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentModelConfig: getAgentModelConfigMock,
    getBuiltinAgent: getBuiltinAgentMock,
  })),
}));

const db = {} as any;

describe('resolveVerifyModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBuiltinAgentMock.mockResolvedValue({ id: 'builtin-verify' });
  });

  it('recognizes heterogeneous providers that cannot run Verify LLM calls', () => {
    expect(isHeterogeneousVerifyProvider('claude-code')).toBe(true);
    expect(isHeterogeneousVerifyProvider('codex')).toBe(true);
    expect(isHeterogeneousVerifyProvider('openai')).toBe(false);
    expect(isHeterogeneousVerifyProvider(null)).toBe(false);
  });

  it('uses a pinned verifier agent model before the parent run model', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
    });

    await expect(
      resolveVerifyModelConfig(
        db,
        'u',
        {
          parentModel: 'gpt-parent',
          parentProvider: 'openai',
          verifierAgentId: 'agt-verifier',
        },
        'ws',
      ),
    ).resolves.toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });

    expect(getAgentModelConfigMock).toHaveBeenCalledWith('agt-verifier');
    expect(getBuiltinAgentMock).not.toHaveBeenCalled();
  });

  it('filters a heterogeneous parent and falls back to the builtin verifier model', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
    });

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'claude-opus-4-8',
        parentProvider: 'claude-code',
      }),
    ).resolves.toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });

    expect(getBuiltinAgentMock).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.verifyAgent);
    expect(getAgentModelConfigMock).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.verifyAgent);
  });

  it('keeps a normal parent model when no verifier agent is pinned', async () => {
    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'gpt-5.4',
        parentProvider: 'openai',
      }),
    ).resolves.toEqual({ model: 'gpt-5.4', provider: 'openai' });

    expect(getBuiltinAgentMock).not.toHaveBeenCalled();
    expect(getAgentModelConfigMock).not.toHaveBeenCalled();
  });

  it('does not fall back to the parent model when a pinned verifier model is unusable', async () => {
    getAgentModelConfigMock
      .mockResolvedValueOnce({
        model: 'claude-opus-4-8',
        provider: 'claude-code',
      })
      .mockResolvedValueOnce({
        model: 'deepseek-v4-pro',
        provider: 'lobehub',
      });

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'gpt-parent',
        parentProvider: 'openai',
        verifierAgentId: 'agt-verifier',
      }),
    ).resolves.toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });

    expect(getAgentModelConfigMock).toHaveBeenNthCalledWith(1, 'agt-verifier');
    expect(getAgentModelConfigMock).toHaveBeenNthCalledWith(2, BUILTIN_AGENT_SLUGS.verifyAgent);
  });

  it('falls back to the platform defaults when no runnable agent model is available', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'claude-opus-4-8',
      provider: 'claude-code',
    });

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: null,
        parentProvider: null,
      }),
    ).resolves.toEqual({ model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER });
  });
});
