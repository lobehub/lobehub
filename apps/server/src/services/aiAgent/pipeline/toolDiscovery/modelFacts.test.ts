// @vitest-environment node
import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveModelContext } from './modelFacts';

vi.mock('@lobechat/mecha', () => ({
  readFrozenModelFacts: vi.fn(async (input: { model: string; provider: string }) => ({
    cards: [],
    model: input.model,
    provider: input.provider,
  })),
}));

vi.mock('@lobechat/model-runtime', () => ({
  getModelPropertyWithFallback: vi.fn(
    async (id: string, property: string, provider: string, models?: any[]) =>
      models?.find((card) => card.id === id && card.providerId === provider)?.[property],
  ),
}));

vi.mock('@/database/models/aiModel', () => ({ AiModelModel: class {} }));
vi.mock('@/database/models/aiProvider', () => ({ AiProviderModel: class {} }));
vi.mock('@/server/modules/AgentRuntime/resolveModelMediaCapabilities', () => ({
  resolveModelMediaCapabilities: vi.fn(() => ({})),
}));
vi.mock('@/server/modules/Mecha/ModelParams/providers', () => ({
  createServerModelParamsProviders: vi.fn(() => ({})),
}));
vi.mock('../../searchDecision', () => ({ resolveServerSearchDecision: vi.fn(() => ({})) }));
vi.mock('../discoveryTracing', () => ({
  markDegradedStage: vi.fn(),
  traceDiscoveryStage: vi.fn(),
}));

const deps = { db: {}, userId: 'user_1' } as any;
const ctx = { agentConfig: { id: 'agt_1' }, model: 'qwen', provider: 'siliconcloud' } as any;
const bank = [{ contextWindowTokens: 131_072, id: 'qwen', providerId: 'siliconcloud' }] as any;

const metadata = (row: PromiseSettledResult<unknown>) =>
  Promise.resolve([row, { status: 'fulfilled', value: undefined }] as any);

describe('resolveModelContext compression facts', () => {
  beforeEach(() => {
    vi.mocked(getModelPropertyWithFallback).mockClear();
  });

  it('freezes the window the user set on their own model row', async () => {
    const { modelFacts } = await resolveModelContext(
      deps,
      ctx,
      bank,
      metadata({ status: 'fulfilled', value: { contextWindowTokens: 400_000 } }),
    );

    expect(modelFacts.compression).toEqual({
      maxWindowToken: 400_000,
      modelThresholdRatio: undefined,
    });
  });

  it('freezes the catalog window when the user has no row, reusing the loaded bank', async () => {
    const { modelFacts } = await resolveModelContext(
      deps,
      ctx,
      bank,
      metadata({ status: 'fulfilled', value: undefined }),
    );

    expect(modelFacts.compression?.maxWindowToken).toBe(131_072);
    expect(getModelPropertyWithFallback).toHaveBeenCalledWith(
      'qwen',
      'contextWindowTokens',
      'siliconcloud',
      bank,
    );
  });

  it('leaves compression out when the row read failed, so each step reads it live', async () => {
    const { modelFacts } = await resolveModelContext(
      deps,
      ctx,
      bank,
      metadata({ reason: new Error('db down'), status: 'rejected' }),
    );

    expect(modelFacts).not.toHaveProperty('compression');
  });
});
