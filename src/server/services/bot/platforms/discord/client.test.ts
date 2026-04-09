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

  describe('extractFiles', () => {
    // Discord is the easy case: attachments come with public CDN URLs that
    // require no auth and survive `Message.toJSON` unchanged. extractFiles
    // just walks `att.url` and (Discord-specific) digs into
    // `raw.referenced_message.attachments` for quoted-message attachments.

    const makeMessage = (overrides: Record<string, unknown>) =>
      ({
        attachments: [],
        id: 'msg-1',
        text: '',
        ...overrides,
      }) as any;

    it('returns undefined when no attachments are present', async () => {
      const client = createClient();
      const result = await client.extractFiles!(makeMessage({ attachments: [] }));
      expect(result).toBeUndefined();
    });

    it('forwards direct attachments by URL with metadata', async () => {
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          attachments: [
            {
              mimeType: 'image/png',
              name: 'screenshot.png',
              size: 4321,
              type: 'image',
              url: 'https://cdn.discordapp.com/attachments/123/456/screenshot.png',
            },
          ],
        }),
      );

      expect(result).toEqual([
        {
          mimeType: 'image/png',
          name: 'screenshot.png',
          size: 4321,
          url: 'https://cdn.discordapp.com/attachments/123/456/screenshot.png',
        },
      ]);
    });

    it('skips direct attachments missing url', async () => {
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          attachments: [
            { mimeType: 'image/png', name: 'orphan.png', type: 'image' },
            {
              mimeType: 'image/png',
              name: 'good.png',
              type: 'image',
              url: 'https://cdn.discordapp.com/attachments/123/456/good.png',
            },
          ],
        }),
      );
      expect(result).toEqual([
        {
          mimeType: 'image/png',
          name: 'good.png',
          size: undefined,
          url: 'https://cdn.discordapp.com/attachments/123/456/good.png',
        },
      ]);
    });

    it('picks up referenced (quoted) message attachments via raw payload', async () => {
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          attachments: [],
          raw: {
            referenced_message: {
              attachments: [
                {
                  content_type: 'image/jpeg',
                  filename: 'quoted.jpg',
                  size: 100,
                  url: 'https://cdn.discordapp.com/attachments/123/456/quoted.jpg',
                },
              ],
            },
          },
        }),
      );

      expect(result).toEqual([
        {
          mimeType: 'image/jpeg',
          name: 'quoted.jpg',
          size: 100,
          url: 'https://cdn.discordapp.com/attachments/123/456/quoted.jpg',
        },
      ]);
    });

    it('combines direct and referenced attachments in order', async () => {
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          attachments: [
            {
              mimeType: 'image/png',
              name: 'direct.png',
              type: 'image',
              url: 'https://cdn.discordapp.com/attachments/123/456/direct.png',
            },
          ],
          raw: {
            referenced_message: {
              attachments: [
                {
                  content_type: 'image/jpeg',
                  filename: 'quoted.jpg',
                  size: 100,
                  url: 'https://cdn.discordapp.com/attachments/123/456/quoted.jpg',
                },
              ],
            },
          },
        }),
      );

      expect(result).toHaveLength(2);
      expect(result?.[0]?.name).toBe('direct.png');
      expect(result?.[1]?.name).toBe('quoted.jpg');
    });

    it('returns undefined when neither direct nor referenced attachments have urls', async () => {
      const client = createClient();
      const result = await client.extractFiles!(
        makeMessage({
          attachments: [{ mimeType: 'image/png', name: 'no-url.png', type: 'image' }],
          raw: { referenced_message: { attachments: [] } },
        }),
      );
      expect(result).toBeUndefined();
    });
  });
});
