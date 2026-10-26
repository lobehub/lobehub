// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import {
  resolveDisputePanelModelConfigs,
  resolveGoalReviewModelConfig,
} from '../goalReviewModelConfig';

const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  task: vi.fn(),
  init: vi.fn(),
  models: vi.fn(),
  goal: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentModelConfig: mocks.agent };
  }),
}));
vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(function () {
    return { findById: mocks.task };
  }),
}));
vi.mock('@/database/repositories/aiInfra', () => ({
  AiInfraRepos: vi.fn(function () {
    return { getAiProviderModelList: mocks.models };
  }),
}));
vi.mock('@/server/globalConfig', () => ({
  getServerGlobalConfig: vi.fn().mockResolvedValue({ aiProvider: {} }),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mocks.init }));
vi.mock('@/server/services/goal/modelConfig', () => ({ resolveGoalModelConfig: mocks.goal }));
vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DEFAULT_ACCEPTANCE_DISPUTE_PANEL: [
    { model: 'claude', provider: 'anthropic' },
    { model: 'gemini', provider: 'google' },
    { model: 'deepseek', provider: 'deepseek' },
  ],
}));
vi.mock('../modelConfig', () => ({
  REVIEW_PREDICT_MODEL_CONFIG: { model: 'gemini', provider: 'google' },
  isHeterogeneousVerifyProvider: (provider: string) => provider === 'codex',
}));
const db = {} as LobeChatDatabase;
const configured = { model: 'gpt-4o', provider: 'openai' };
const resolve = (requiresVision = false, verifierAgentId?: string) =>
  resolveGoalReviewModelConfig(db, 'u1', { taskId: 't1', requiresVision, verifierAgentId }, 'w1');

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.agent.mockResolvedValue(null);
  mocks.task.mockResolvedValue({ config: configured });
  mocks.goal.mockResolvedValue({ model: 'unavailable', provider: 'google' });
  mocks.models.mockResolvedValue([{ id: 'gpt-4o', abilities: { vision: true } }]);
  mocks.init.mockImplementation(async (_db, _user, provider) => {
    if (provider === 'google') throw new Error('Google credentials are absent');
    return {};
  });
});

describe('Goal review model selection', () => {
  it('uses an explicitly configured verifier without initializing Google', async () => {
    mocks.agent.mockResolvedValue(configured);
    expect(await resolve(true, 'verifier')).toEqual(configured);
    expect(mocks.init).toHaveBeenCalledExactlyOnceWith(db, 'u1', 'openai', 'w1');
  });
  it('keeps the pinned reviewer when the deployment can initialize it', async () => {
    mocks.init.mockResolvedValue({});
    expect(await resolve()).toEqual({ model: 'gemini', provider: 'google' });
  });
  it('falls back to the configured task model for program checks without Google', async () => {
    expect(await resolve()).toEqual(configured);
  });
  it('uses a vision-capable fallback for screenshot evidence', async () => {
    expect(await resolve(true)).toEqual(configured);
  });
  it('never silently sends screenshots to a text-only fallback', async () => {
    mocks.models.mockResolvedValue([{ id: 'gpt-4o', abilities: { vision: false } }]);
    expect(await resolve(true)).toBeUndefined();
  });
  it('allows a configured text-only model for text evidence', async () => {
    mocks.models.mockResolvedValue([]);
    expect(await resolve()).toEqual(configured);
  });
  it('does not treat a CLI agent as an LLM review provider', async () => {
    mocks.task.mockResolvedValue({ config: { model: 'codex-model', provider: 'codex' } });
    expect(await resolve()).toBeUndefined();
    expect(mocks.init.mock.calls.some((call) => call[2] === 'codex')).toBe(false);
  });
});

describe('Dispute panel selection', () => {
  const panel = () => resolveDisputePanelModelConfigs(db, 'u1', { taskId: 't1' }, 'w1');

  it('seats the pinned cross-vendor panel when every provider initializes', async () => {
    mocks.init.mockResolvedValue({});
    expect(await panel()).toEqual([
      { model: 'claude', provider: 'anthropic' },
      { model: 'gemini', provider: 'google' },
      { model: 'deepseek', provider: 'deepseek' },
    ]);
    expect(mocks.task).not.toHaveBeenCalled();
  });

  it('tops up an unavailable member from the review chain without repeating a seat', async () => {
    // Google is down: its pinned seat and the pinned reviewer (also Google) are skipped.
    expect(await panel()).toEqual([
      { model: 'claude', provider: 'anthropic' },
      { model: 'deepseek', provider: 'deepseek' },
      configured,
    ]);
  });

  /**
   * Regression: fallback seats only had to differ by model, so three models
   * from one vendor could make up the majority that waives a check.
   */
  it('never seats a second model from a provider already on the panel', async () => {
    mocks.init.mockImplementation(async (_db, _user, provider) => {
      if (provider !== 'openai') throw new Error('absent');
      return {};
    });
    mocks.agent.mockResolvedValue({ model: 'gpt-4.1', provider: 'openai' });
    mocks.goal.mockResolvedValue({ model: 'o3', provider: 'openai' });

    // The builtin verifier, the task model and the goal model are all OpenAI: one seat only.
    const seated = await panel();
    expect(seated).toHaveLength(1);
    expect(seated[0].provider).toBe('openai');
  });

  it('returns a short panel rather than seating the same model twice', async () => {
    mocks.init.mockImplementation(async (_db, _user, provider) => {
      if (provider !== 'openai') throw new Error('absent');
      return {};
    });
    mocks.agent.mockResolvedValue(configured);
    expect(await panel()).toEqual([configured]);
  });
});
