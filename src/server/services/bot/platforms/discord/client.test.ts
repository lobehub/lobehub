import { describe, expect, it } from 'vitest';

import { DiscordClientFactory } from './client';

describe('DiscordGatewayClient', () => {
  const createClient = () =>
    new DiscordClientFactory().createClient(
      {
        applicationId: 'app-123',
        credentials: { botToken: 'token', publicKey: 'public-key' },
        platform: 'discord',
        settings: {},
      },
      {},
    );

  describe('shouldSubscribe', () => {
    it('should not subscribe to top-level guild channels', () => {
      const client = createClient();

      expect(client.shouldSubscribe?.('discord:guild-1:channel-1')).toBe(false);
    });

    it('should subscribe to Discord threads', () => {
      const client = createClient();

      expect(client.shouldSubscribe?.('discord:guild-1:channel-1:thread-1')).toBe(true);
    });

    it('should subscribe to DMs', () => {
      const client = createClient();

      expect(client.shouldSubscribe?.('discord:@me:dm-channel-1')).toBe(true);
    });
  });
});
