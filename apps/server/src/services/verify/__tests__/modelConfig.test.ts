import {
  LOCAL_HETEROGENEOUS_AGENT_TYPES,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isHeterogeneousVerifyProvider,
  resolveVerifyModelConfig,
  REVIEW_PREDICT_MODEL_CONFIG,
  VERIFY_FALLBACK_MODEL_CONFIG,
} from '../modelConfig';

const { appEnvMock, getAgentModelConfigMock, getUserSettingsMock } = vi.hoisted(() => ({
  appEnvMock: { SYSTEM_AGENT: '' as string | undefined },
  getAgentModelConfigMock: vi.fn(),
  getUserSettingsMock: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return { getAgentModelConfig: getAgentModelConfigMock };
  }),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: getUserSettingsMock };
  }),
}));

vi.mock('@/envs/app', () => ({ appEnv: appEnvMock }));

const db = {} as any;

describe('resolveVerifyModelConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appEnvMock.SYSTEM_AGENT = '';
    getUserSettingsMock.mockResolvedValue({});
  });

  it('recognizes heterogeneous providers that cannot run Verify LLM calls', () => {
    const heterogeneousProviders = [
      ...LOCAL_HETEROGENEOUS_AGENT_TYPES,
      ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type),
    ];

    for (const provider of heterogeneousProviders) {
      expect(isHeterogeneousVerifyProvider(provider)).toBe(true);
    }
    expect(isHeterogeneousVerifyProvider('openai')).toBe(false);
    expect(isHeterogeneousVerifyProvider(null)).toBe(false);
  });

  it('uses a pinned verifier agent model before the verify service model', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'deepseek-v4-pro',
      provider: 'lobehub',
    });
    getUserSettingsMock.mockResolvedValue({
      systemAgent: { verify: { model: 'gpt-user', provider: 'openai' } },
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
    expect(getUserSettingsMock).not.toHaveBeenCalled();
  });

  it('uses the user verify service model when no verifier agent is pinned', async () => {
    getUserSettingsMock.mockResolvedValue({
      systemAgent: { verify: { model: 'gpt-5.6', provider: 'openai' } },
    });

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'claude-opus-4-8',
        parentProvider: 'claude-code',
      }),
    ).resolves.toEqual({ model: 'gpt-5.6', provider: 'openai' });

    expect(getAgentModelConfigMock).not.toHaveBeenCalled();
  });

  it('uses the deployment SYSTEM_AGENT verify model when the user has none', async () => {
    appEnvMock.SYSTEM_AGENT = 'verify=google/gemini-3.8-flash';

    await expect(resolveVerifyModelConfig(db, 'u', {})).resolves.toEqual({
      model: 'gemini-3.8-flash',
      provider: 'google',
    });
  });

  it('lets SYSTEM_AGENT default= repoint verification for self-hosted deployments', async () => {
    appEnvMock.SYSTEM_AGENT = 'default=openai/gpt-5.6';

    await expect(resolveVerifyModelConfig(db, 'u', {})).resolves.toEqual({
      model: 'gpt-5.6',
      provider: 'openai',
    });
  });

  /**
   * Regression: the chain read the builtin verify agent's row before the
   * vision-capable floor. That row is persisted with the generic chat default
   * (text-only deepseek-v4-flash) and has no UI, so the floor was never reached
   * and screenshot checks judged on a model that could not see them.
   */
  it('falls to the vision-capable floor instead of the builtin verify agent row', async () => {
    getAgentModelConfigMock.mockResolvedValue({ model: 'deepseek-v4-flash', provider: 'deepseek' });

    await expect(resolveVerifyModelConfig(db, 'u', {})).resolves.toEqual(
      VERIFY_FALLBACK_MODEL_CONFIG,
    );
    expect(getAgentModelConfigMock).not.toHaveBeenCalled();
  });

  it('ignores a usable parent model and judges on the verifier chain', async () => {
    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'gpt-5.4',
        parentProvider: 'openai',
      }),
    ).resolves.toEqual(VERIFY_FALLBACK_MODEL_CONFIG);
  });

  it('skips an unusable pinned verifier and a heterogeneous service model', async () => {
    getAgentModelConfigMock.mockResolvedValueOnce({
      model: 'claude-opus-4-8',
      provider: 'claude-code',
    });
    getUserSettingsMock.mockResolvedValue({
      systemAgent: { verify: { model: 'gpt-5.5-codex', provider: 'codex' } },
    });
    appEnvMock.SYSTEM_AGENT = 'verify=zhipu/glm-5.3';

    await expect(
      resolveVerifyModelConfig(db, 'u', {
        parentModel: 'gpt-parent',
        parentProvider: 'openai',
        verifierAgentId: 'agt-verifier',
      }),
    ).resolves.toEqual({ model: 'glm-5.3', provider: 'zhipu' });
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
