// @vitest-environment node
import { DiscordAPIError } from '@discordjs/rest';
import { MessagePlatformError } from '@lobechat/builtin-tool-message/executionRuntime';
import { describe, expect, it, vi } from 'vitest';

import { explainDiscordErrors, toDiscordToolError } from './errors';

const API = 'https://discord.com/api/v10';

const discordError = (code: number, message: string, status: number, route: string) =>
  new DiscordAPIError({ code, message }, code, status, 'GET', `${API}${route}`, {
    body: { content: 'private draft' },
  });

describe('toDiscordToolError', () => {
  it('names the channel and both causes for Missing Access', () => {
    const error = toDiscordToolError(
      discordError(
        50_001,
        'Missing Access',
        403,
        '/channels/1478668801703678056/messages?limit=50',
      ),
    );

    expect(error).toBeInstanceOf(MessagePlatformError);
    const { data } = error as MessagePlatformError;
    expect(data).toMatchObject({
      code: 'DISCORD_MISSING_ACCESS',
      kind: 'stop',
      platformCode: 50_001,
      status: 403,
    });
    expect(data.message).toContain('channel 1478668801703678056');
    expect(data.message).toContain('not a member of its server');
    expect(data.message).toContain('lacks View Channel');
    expect(data.hint).toContain('Do not retry');
    // The request body (message text) must not ride along into the tool error.
    expect(JSON.stringify(data)).not.toContain('private draft');
  });

  it('tells a missing permission apart from a hidden channel', () => {
    const error = toDiscordToolError(
      discordError(50_013, 'Missing Permissions', 403, '/channels/1233998293818671126/messages'),
    ) as MessagePlatformError;

    expect(error.data).toMatchObject({ code: 'DISCORD_MISSING_PERMISSIONS', kind: 'stop' });
    expect(error.message).toContain('can see channel 1233998293818671126');
    expect(error.message).toContain('Send Messages');
  });

  it('reports an unknown channel as a wrong id to replan with', () => {
    const error = toDiscordToolError(
      discordError(10_003, 'Unknown Channel', 404, '/channels/1/messages'),
    ) as MessagePlatformError;

    expect(error.data).toMatchObject({
      code: 'DISCORD_UNKNOWN_CHANNEL',
      kind: 'replan',
      status: 404,
    });
    expect(error.message).toContain('channel 1 does not exist');
    expect(error.data.hint).toContain('listChannels');
  });

  it('names the server for guild routes', () => {
    const error = toDiscordToolError(
      discordError(10_004, 'Unknown Guild', 404, '/guilds/42/channels'),
    ) as MessagePlatformError;

    expect(error.data.code).toBe('DISCORD_UNKNOWN_GUILD');
    expect(error.message).toContain('server 42');
  });

  it('passes other errors through unchanged', () => {
    const rateLimited = discordError(0, 'You are being rate limited.', 429, '/channels/1/messages');
    const plain = new Error('socket hang up');

    expect(toDiscordToolError(rateLimited)).toBe(rateLimited);
    expect(toDiscordToolError(plain)).toBe(plain);
  });
});

describe('explainDiscordErrors', () => {
  it('forwards calls and explains a refusal', async () => {
    const api = {
      getChannel: vi
        .fn()
        .mockRejectedValue(discordError(50_001, 'Missing Access', 403, '/channels/9')),
      getMessages: vi.fn().mockResolvedValue([{ id: '1' }]),
    };
    const explained = explainDiscordErrors(api);

    await expect(explained.getMessages('9', { limit: 1 })).resolves.toEqual([{ id: '1' }]);
    expect(api.getMessages).toHaveBeenCalledWith('9', { limit: 1 });
    await expect(explained.getChannel('9')).rejects.toMatchObject({
      data: { code: 'DISCORD_MISSING_ACCESS' },
    });
  });
});
