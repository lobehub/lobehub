import type * as BusinessDefaults from '@lobechat/business-const';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYSTEM_AGENT_CONFIG } from './systemAgent';

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<typeof BusinessDefaults>()),
  DEFAULT_CHANNEL_ROUTING_MODEL: undefined,
  DEFAULT_CHANNEL_ROUTING_PROVIDER: undefined,
}));

describe('channel decision defaults with an older distribution overlay', () => {
  it('retains the enabled self-hosted fallback when the overlay has no decision defaults', () => {
    expect(DEFAULT_SYSTEM_AGENT_CONFIG.channelRouting).toEqual({
      enabled: true,
      model: 'jev-1.14.0',
      provider: 'typesafe',
    });
  });
});
