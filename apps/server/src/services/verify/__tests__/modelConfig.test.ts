import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isHeterogeneousVerifyProvider,
  resolveVerifyModelConfig,
  REVIEW_PREDICT_MODEL_CONFIG,
  VERIFY_FALLBACK_MODEL_CONFIG,
} from '../modelConfig';

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
    expect(isHeterogeneousVerifyProvider('cursor')).toBe(true);
    expect(isHeterogeneousVerifyProvider('droid')).toBe(true);
    expect(isHeterogeneousVerifyProvider('openai')).toBe(false);
    expect(isHeterogeneousVerifyProvider(null)).toBe(false);
  });

  it('uses a pinned verifier agent model before the builtin verify agent', async () => {
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

  it('falls back to the builtin verify agent model for a heterogeneous parent', async () => {
    getAgentModelConfigMock
      // 1st call: no pinned verifier (undefined → not called), so the mock
      // queue starts at the builtin slug lookup.
      .mockResolvedValueOnce({
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

  /**
   * Regression: the resolver used to inherit the parent run's model, so the
   * verification bar drifted with whichever chat model spawned the task. The
   * parent model is no longer a resolution source — verification judges on
   * the verifier chain exclusively.
   */
  it('ignores a usable parent model and judges on the verifier chain', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
    });

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'gpt-5.4',
        parentProvider: 'openai',
      }),
    ).resolves.toEqual({ model: 'deepseek-v4-pro', provider: 'lobehub' });

    expect(getAgentModelConfigMock).toHaveBeenCalledWith(BUILTIN_AGENT_SLUGS.verifyAgent);
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

  it('falls back to the pinned verify model when no runnable agent model is available', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'claude-opus-4-8',
      provider: 'claude-code',
    });

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: null,
        parentProvider: null,
      }),
    ).resolves.toEqual(VERIFY_FALLBACK_MODEL_CONFIG);
  });
});

describe('VERIFY_FALLBACK_MODEL_CONFIG', () => {
  /**
   * Regression: the verify fallback once rode the platform default chat
   * model (deepseek-v4-pro). It has no native vision, so agent-type checks
   * detoured screenshot evidence through a vision sub-agent and the tail of
   * that long chain dropped the verdict submission — every r6 check errored
   * in production. The pinned model must be able to actually see the frames.
   */
  it('pins a model that model-bank says can read images', async () => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const card = LOBE_DEFAULT_MODEL_LIST.find(
      (model) =>
        model.id === VERIFY_FALLBACK_MODEL_CONFIG.model &&
        model.providerId === VERIFY_FALLBACK_MODEL_CONFIG.provider &&
        model.type === 'chat',
    );
    expect(
      card,
      `${VERIFY_FALLBACK_MODEL_CONFIG.provider}/${VERIFY_FALLBACK_MODEL_CONFIG.model} is not a chat model in model-bank`,
    ).toBeDefined();
    expect(card!.abilities?.vision).toBe(true);
  });
});

describe('REVIEW_PREDICT_MODEL_CONFIG', () => {
  /**
   * Regression: in production the predictor once inherited the verifier's text
   * model (deepseek-v4-pro). The channel stripped the screenshots, the model
   * "accepted on missing evidence" for every check, and no proposal ever
   * surfaced. The pinned model must be able to actually see the frames.
   */
  it('pins a model that model-bank says can read images', async () => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const card = LOBE_DEFAULT_MODEL_LIST.find(
      (model) =>
        model.id === REVIEW_PREDICT_MODEL_CONFIG.model &&
        model.providerId === REVIEW_PREDICT_MODEL_CONFIG.provider &&
        model.type === 'chat',
    );
    expect(
      card,
      `${REVIEW_PREDICT_MODEL_CONFIG.provider}/${REVIEW_PREDICT_MODEL_CONFIG.model} is not a chat model in model-bank`,
    ).toBeDefined();
    expect(card!.abilities?.vision).toBe(true);
  });
});
