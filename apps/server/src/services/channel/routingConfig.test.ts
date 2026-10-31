// @vitest-environment node
import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveChannelRoutingConfig } from './routingConfig';

const { settings, env } = vi.hoisted(() => ({
  settings: vi.fn(),
  env: { SYSTEM_AGENT: '' },
}));
vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = settings;
  },
}));
vi.mock('@/envs/app', () => ({ appEnv: env }));
afterEach(() => {
  env.SYSTEM_AGENT = '';
  vi.resetAllMocks();
});

describe('Channel service model configuration', () => {
  it('enables the distribution decision model by default', async () => {
    const { model, provider } = DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting;
    expect(await resolveChannelRoutingConfig({} as never, 'user')).toEqual({ model, provider });
  });
  it('uses the explicit Jev default when opted in', async () => {
    settings.mockResolvedValue({ systemAgent: { channelRouting: { enabled: true } } });
    expect(await resolveChannelRoutingConfig({} as never, 'user')).toEqual({
      model: DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting.model,
      provider: DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting.provider,
    });
  });
  it('supports deployment selection and never inherits a generic chat default', async () => {
    env.SYSTEM_AGENT = 'default=openai/gpt-5';
    expect(await resolveChannelRoutingConfig({} as never, 'user')).toEqual({
      model: DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting.model,
      provider: DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting.provider,
    });
    env.SYSTEM_AGENT += ',channelRouting=openrouter/typesafe/jev-1.13';
    expect(await resolveChannelRoutingConfig({} as never, 'user')).toEqual({
      model: 'typesafe/jev-1.13',
      provider: 'openrouter',
    });
  });
  it('prefers a saved decision model over the deployment choice', async () => {
    env.SYSTEM_AGENT = 'channelRouting=typesafe/jev-1.14.0';
    settings.mockResolvedValue({
      systemAgent: {
        channelRouting: { enabled: true, model: 'custom-decision', provider: 'custom' },
      },
    });
    expect(await resolveChannelRoutingConfig({} as never, 'user')).toEqual({
      model: 'custom-decision',
      provider: 'custom',
    });
  });
  it('honors an explicit user opt-out over deployment configuration', async () => {
    env.SYSTEM_AGENT = 'channelRouting=typesafe/jev-1.14.0';
    settings.mockResolvedValue({ systemAgent: { channelRouting: { enabled: false } } });
    expect(await resolveChannelRoutingConfig({} as never, 'user')).toBeNull();
  });
});
