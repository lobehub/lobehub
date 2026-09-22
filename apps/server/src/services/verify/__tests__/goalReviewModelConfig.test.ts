// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { resolveGoalReviewModelConfig } from '../goalReviewModelConfig';

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
