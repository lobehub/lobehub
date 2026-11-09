// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { resolveVerifyPlanModelConfig } from '../planModelConfig';

const mocks = vi.hoisted(() => ({ init: vi.fn(), serviceModel: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: mocks.init }));
vi.mock('../modelConfig', () => ({
  VERIFY_PLAN_MODEL_CONFIG: { model: 'deepseek-flash', provider: 'deepseek' },
  resolveVerifyServiceModel: mocks.serviceModel,
}));

const db = {} as LobeChatDatabase;
const pinned = { model: 'deepseek-flash', provider: 'deepseek' };
const service = { model: 'gpt-4o', provider: 'openai' };
const resolve = () => resolveVerifyPlanModelConfig(db, 'u1', 'w1');
const unavailable = (...providers: string[]) =>
  mocks.init.mockImplementation(async (_db, _user, provider: string) => {
    if (providers.includes(provider)) throw new Error(`${provider} credentials are absent`);
    return {};
  });

beforeEach(() => {
  mocks.init.mockReset();
  mocks.serviceModel.mockReset();
  mocks.serviceModel.mockResolvedValue(service);
});

describe('verify plan model selection', () => {
  it('keeps the pinned plan model when the deployment can run it', async () => {
    unavailable();
    expect(await resolve()).toEqual(pinned);
    expect(mocks.init).toHaveBeenCalledExactlyOnceWith(db, 'u1', 'deepseek', 'w1');
    expect(mocks.serviceModel).not.toHaveBeenCalled();
  });

  it('falls back to the verify service model when the pinned provider has no credentials', async () => {
    unavailable('deepseek');
    expect(await resolve()).toEqual(service);
  });

  it('keeps the pin when no service model is set, so its credential error surfaces', async () => {
    unavailable('deepseek');
    mocks.serviceModel.mockResolvedValue(undefined);
    expect(await resolve()).toEqual(pinned);
  });

  it('keeps the pin when the service model cannot run either', async () => {
    unavailable('deepseek', 'openai');
    expect(await resolve()).toEqual(pinned);
  });
});
