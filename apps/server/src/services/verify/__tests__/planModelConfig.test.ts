// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { runOnVerifyPlanModel } from '../planModelConfig';

const mocks = vi.hoisted(() => ({ serviceModel: vi.fn() }));
vi.mock('../modelConfig', () => ({
  VERIFY_PLAN_MODEL_CONFIG: { model: 'deepseek-flash', provider: 'deepseek' },
  resolveVerifyServiceModel: mocks.serviceModel,
}));

const db = {} as LobeChatDatabase;
const pinned = { model: 'deepseek-flash', provider: 'deepseek' };
const service = { model: 'gpt-4o', provider: 'openai' };
const invalidKey = { errorType: 'InvalidProviderAPIKey', provider: 'deepseek' };

beforeEach(() => {
  mocks.serviceModel.mockReset();
  mocks.serviceModel.mockResolvedValue(service);
});

describe('runOnVerifyPlanModel', () => {
  it('runs on the pinned plan model without reading the service model', async () => {
    const run = vi.fn(async () => 'ok');
    expect(await runOnVerifyPlanModel(db, 'u1', run)).toBe('ok');
    expect(run).toHaveBeenCalledExactlyOnceWith(pinned);
    expect(mocks.serviceModel).not.toHaveBeenCalled();
  });

  it('retries once on the verify service model when the pin has an invalid key', async () => {
    const run = vi.fn().mockRejectedValueOnce(invalidKey).mockResolvedValueOnce('ok');
    expect(await runOnVerifyPlanModel(db, 'u1', run)).toBe('ok');
    expect(run.mock.calls).toEqual([[pinned], [service]]);
  });

  it('does not retry on other failures', async () => {
    const run = vi.fn().mockRejectedValue({ errorType: 'ProviderServiceUnavailable' });
    await expect(runOnVerifyPlanModel(db, 'u1', run)).rejects.toEqual({
      errorType: 'ProviderServiceUnavailable',
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rethrows the invalid-key error when no service model is set', async () => {
    mocks.serviceModel.mockResolvedValue(undefined);
    const run = vi.fn().mockRejectedValue(invalidKey);
    await expect(runOnVerifyPlanModel(db, 'u1', run)).rejects.toBe(invalidKey);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rethrows when the service model is the pinned model itself', async () => {
    mocks.serviceModel.mockResolvedValue(pinned);
    const run = vi.fn().mockRejectedValue(invalidKey);
    await expect(runOnVerifyPlanModel(db, 'u1', run)).rejects.toBe(invalidKey);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
