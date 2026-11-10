// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCompressionModelFacts } from '../compressionModelFacts';

const mocks = vi.hoisted(() => ({
  bank: {} as Record<string, unknown>,
  findByIdAndProvider: vi.fn(),
}));

vi.mock('@lobechat/model-runtime', () => ({
  getModelPropertyWithFallback: vi.fn(
    async (_model: string, property: string) => mocks.bank[property],
  ),
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: class {
    findByIdAndProvider = mocks.findByIdAndProvider;
  },
}));

const deps = { serverDB: {} as any, userId: 'user_1' };

describe('resolveCompressionModelFacts', () => {
  beforeEach(() => {
    mocks.bank = {};
    mocks.findByIdAndProvider.mockReset().mockResolvedValue(undefined);
  });

  it('uses the catalog window when the user has no model row', async () => {
    mocks.bank = { contextWindowTokens: 200_000 };

    await expect(resolveCompressionModelFacts(deps, 'claude', 'anthropic')).resolves.toEqual({
      maxWindowToken: 200_000,
      modelThresholdRatio: undefined,
    });
  });

  it('passes the model-bank compression ratio through', async () => {
    mocks.bank = { compressionThresholdRatio: 0.8, contextWindowTokens: 200_000 };

    await expect(resolveCompressionModelFacts(deps, 'claude', 'anthropic')).resolves.toEqual({
      maxWindowToken: 200_000,
      modelThresholdRatio: 0.8,
    });
  });

  it('prefers the window the user set on a custom model row', async () => {
    mocks.findByIdAndProvider.mockResolvedValue({ contextWindowTokens: 400_000 });

    await expect(resolveCompressionModelFacts(deps, 'my-model', 'custom')).resolves.toEqual({
      maxWindowToken: 400_000,
      modelThresholdRatio: undefined,
    });
    expect(mocks.findByIdAndProvider).toHaveBeenCalledWith('my-model', 'custom');
  });

  it('prefers a user-edited window over the catalog window', async () => {
    mocks.bank = { contextWindowTokens: 200_000 };
    mocks.findByIdAndProvider.mockResolvedValue({ contextWindowTokens: 1_000_000 });

    const facts = await resolveCompressionModelFacts(deps, 'claude', 'anthropic');
    expect(facts.maxWindowToken).toBe(1_000_000);
  });

  it('keeps the catalog window when the user row has none', async () => {
    mocks.bank = { contextWindowTokens: 200_000 };
    mocks.findByIdAndProvider.mockResolvedValue({ contextWindowTokens: null });

    const facts = await resolveCompressionModelFacts(deps, 'claude', 'anthropic');
    expect(facts.maxWindowToken).toBe(200_000);
  });

  it('falls back to the catalog window when the user row read fails', async () => {
    mocks.bank = { contextWindowTokens: 200_000 };
    mocks.findByIdAndProvider.mockRejectedValue(new Error('db down'));

    const facts = await resolveCompressionModelFacts(deps, 'claude', 'anthropic');
    expect(facts.maxWindowToken).toBe(200_000);
  });

  it('leaves the window unknown when neither source has it', async () => {
    await expect(resolveCompressionModelFacts(deps, 'unknown', 'custom')).resolves.toEqual({
      maxWindowToken: undefined,
      modelThresholdRatio: undefined,
    });
  });
});
