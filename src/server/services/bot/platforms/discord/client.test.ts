import { describe, expect, it, vi } from 'vitest';

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

  describe('extraGroupAllowlistChannels', () => {
    // Operators paste the parent channel ID (Discord "Copy Channel ID")
    // into groupAllowFrom; @-mentions arrive routed through an auto-created
    // reply thread, so `thread.channelId` is the thread, not the parent.
    // This hook surfaces the parent so the allowlist still matches.
    it('returns the parent channel ID when the thread segment is present', () => {
      const client = createClient();

      expect(
        client.extraGroupAllowlistChannels?.('discord:guild-1:channel-1:auto-thread-id'),
      ).toEqual(['channel-1']);
    });

    it('returns an empty list for top-level channels (parent already supplied)', () => {
      const client = createClient();

      expect(client.extraGroupAllowlistChannels?.('discord:guild-1:channel-1')).toEqual([]);
    });

    it('returns an empty list for DMs (no parent concept)', () => {
      const client = createClient();

      expect(client.extraGroupAllowlistChannels?.('discord:@me:dm-channel-1')).toEqual([]);
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
      expect((result as any)?.[0]?.name).toBe('direct.png');
      expect((result as any)?.[1]?.name).toBe('quoted.jpg');
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

  describe('openThreadForChannelWake (LOBE-8891)', () => {
    // The chat-sdk Discord adapter only auto-spawns a reply thread on
    // @-mention. For the watch-keyword wake path the bot would otherwise
    // reply directly in the parent channel; this hook opens a thread off
    // the triggering message so the conversation stays isolated.

    const installFakeApi = (client: any, impl: () => any) => {
      // The client is constructed in the factory and holds its own
      // DiscordApi via a private field. Reach in and replace the one
      // method we care about for these tests.
      client.discord = {
        ...client.discord,
        startThreadFromMessage: vi.fn(impl),
      };
      return client.discord.startThreadFromMessage as ReturnType<typeof vi.fn>;
    };

    it('spawns a thread off the triggering message for a top-level guild channel', async () => {
      const client = createClient() as any;
      const spy = installFakeApi(client, async () => ({ id: 'new-thread-1' }));

      const result = await client.openThreadForChannelWake('discord:guild-1:channel-1', {
        id: 'msg-99',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('channel-1');
      expect(spy.mock.calls[0][1]).toBe('msg-99');
      expect(result).toBe('discord:guild-1:channel-1:new-thread-1');
    });

    it('returns undefined for DMs (guildId === @me)', async () => {
      const client = createClient() as any;
      const spy = installFakeApi(client, async () => ({ id: 'never-called' }));

      const result = await client.openThreadForChannelWake('discord:@me:dm-1', { id: 'msg-1' });

      expect(spy).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('returns undefined when the threadId already has a thread segment', async () => {
      // 4-segment IDs already deliver replies inside a sub-thread; no
      // need to spawn another.
      const client = createClient() as any;
      const spy = installFakeApi(client, async () => ({ id: 'never-called' }));

      const result = await client.openThreadForChannelWake(
        'discord:guild-1:channel-1:existing-thread',
        { id: 'msg-1' },
      );

      expect(spy).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it('returns undefined when the message has no usable id', async () => {
      const client = createClient() as any;
      const spy = installFakeApi(client, async () => ({ id: 'never-called' }));

      expect(
        await client.openThreadForChannelWake('discord:guild-1:channel-1', undefined),
      ).toBeUndefined();
      expect(
        await client.openThreadForChannelWake('discord:guild-1:channel-1', {}),
      ).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns undefined and swallows the error when the Discord API rejects', async () => {
      // Best-effort contract: a thread-creation failure must NOT bubble
      // up to the router, since the router would then drop the user's
      // message. Falling back to a channel-level reply is the safer
      // failure mode.
      const client = createClient() as any;
      const spy = installFakeApi(client, async () => {
        throw new Error('boom');
      });

      const result = await client.openThreadForChannelWake('discord:guild-1:channel-1', {
        id: 'msg-99',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(result).toBeUndefined();
    });
  });

  describe('extractAuthorLocale', () => {
    const makeMessage = (overrides: Record<string, unknown>) =>
      ({
        attachments: [],
        id: 'msg-1',
        text: '',
        ...overrides,
      }) as any;

    it('returns the user locale from an INTERACTION_CREATE payload', () => {
      const client = createClient();
      expect(
        client.extractAuthorLocale!(
          makeMessage({ raw: { locale: 'pt-BR', guild_locale: 'en-US' } }),
        ),
      ).toBe('pt-BR');
    });

    it('falls back to guild_locale when the user-level field is missing', () => {
      const client = createClient();
      expect(client.extractAuthorLocale!(makeMessage({ raw: { guild_locale: 'zh-CN' } }))).toBe(
        'zh-CN',
      );
    });

    it('returns undefined for plain MESSAGE_CREATE payloads (Discord does not expose user locale there)', () => {
      const client = createClient();
      expect(
        client.extractAuthorLocale!(
          makeMessage({ raw: { author: { id: '123', username: 'alice' } } }),
        ),
      ).toBeUndefined();
      expect(client.extractAuthorLocale!(makeMessage({ raw: {} }))).toBeUndefined();
      expect(client.extractAuthorLocale!(makeMessage({}))).toBeUndefined();
    });
  });
});
