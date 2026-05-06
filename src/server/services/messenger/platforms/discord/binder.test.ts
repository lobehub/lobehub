// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordApi } from '@/server/services/bot/platforms/discord/api';

import { issueLinkToken } from '../../linkTokenStore';
import { buildDiscordSwitchButtons, MessengerDiscordBinder } from './binder';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@/config/messenger', () => ({
  getMessengerDiscordConfig: vi.fn(async () => ({
    applicationId: 'discord-app-id',
    botToken: 'discord-bot-token',
    botUsername: 'lobehub-bot',
    publicKey: 'discord-public-key',
  })),
}));

vi.mock('../../linkTokenStore', () => ({
  issueLinkToken: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/discord/api', () => ({
  DiscordApi: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/discord/client', () => ({
  DiscordClientFactory: vi.fn(),
}));

let createMessage: ReturnType<typeof vi.fn>;
let createMessageWithButtons: ReturnType<typeof vi.fn>;
let editMessageWithButtons: ReturnType<typeof vi.fn>;
let createDMChannel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createMessage = vi.fn().mockResolvedValue({ id: 'msg_1' });
  createMessageWithButtons = vi.fn().mockResolvedValue({ id: 'picker_1' });
  editMessageWithButtons = vi.fn().mockResolvedValue(undefined);
  createDMChannel = vi.fn().mockResolvedValue({ id: 'dm_channel_1' });

  vi.mocked(DiscordApi).mockImplementation(
    () =>
      ({
        createDMChannel,
        createMessage,
        createMessageWithButtons,
        editMessageWithButtons,
      }) as any,
  );

  vi.mocked(issueLinkToken).mockResolvedValue('rand_token');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildDiscordSwitchButtons', () => {
  it('marks the active entry as primary and prefixes a check', () => {
    const buttons = buildDiscordSwitchButtons([
      { id: 'agt_1', isActive: false, title: 'Default' },
      { id: 'agt_2', isActive: true, title: 'Coding' },
    ]);
    expect(buttons).toEqual([
      { customId: 'messenger:switch:agt_1', isPrimary: false, label: 'Default' },
      { customId: 'messenger:switch:agt_2', isPrimary: true, label: '✓ Coding' },
    ]);
  });
});

describe('MessengerDiscordBinder', () => {
  describe('handleUnlinkedMessage', () => {
    it('opens the user DM via authorUserId and posts the verify-im markdown link there', async () => {
      const binder = new MessengerDiscordBinder();
      await binder.handleUnlinkedMessage({
        authorUserId: 'discord_user_42',
        authorUserName: 'tester',
        // Inbound chatId may be a public slash-invocation channel; the
        // binder must ignore it and resolve a private DM via openDM.
        chatId: 'public_channel_xyz',
        message: undefined as any,
      });

      expect(createDMChannel).toHaveBeenCalledWith('discord_user_42');
      expect(issueLinkToken).toHaveBeenCalledWith({
        platform: 'discord',
        platformUserId: 'discord_user_42',
        platformUsername: 'tester',
      });
      expect(createMessage).toHaveBeenCalledTimes(1);
      const [channel, body] = createMessage.mock.calls[0];
      expect(channel).toBe('dm_channel_1');
      expect(body).toContain('https://app.example.com/verify-im');
      expect(body).toContain('im_type=discord');
      expect(body).toContain('random_id=rand_token');
    });
  });

  describe('notifyLinkSuccess', () => {
    it('opens a DM channel for the recipient and posts the success message', async () => {
      const binder = new MessengerDiscordBinder();
      await binder.notifyLinkSuccess({
        activeAgentName: 'Coding',
        platformUserId: 'discord_user_42',
      });

      expect(createDMChannel).toHaveBeenCalledWith('discord_user_42');
      expect(createMessage).toHaveBeenCalledWith(
        'dm_channel_1',
        expect.stringContaining('Linked successfully'),
      );
      expect(createMessage.mock.calls[0][1]).toContain('**Coding**');
    });

    it('swallows errors when the user has DMs disabled', async () => {
      createDMChannel.mockRejectedValueOnce(new Error('Cannot send messages to this user'));
      const binder = new MessengerDiscordBinder();
      await expect(
        binder.notifyLinkSuccess({ platformUserId: 'discord_user_42' }),
      ).resolves.toBeUndefined();
      expect(createMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendAgentPicker', () => {
    it('posts a message with switch buttons mapped from picker entries', async () => {
      const binder = new MessengerDiscordBinder();
      await binder.sendAgentPicker('dm_channel_xyz', {
        entries: [
          { id: 'agt_1', isActive: true, title: 'Inbox' },
          { id: 'agt_2', isActive: false, title: 'Coding' },
        ],
        text: 'Pick an agent:',
      });

      expect(createMessageWithButtons).toHaveBeenCalledWith('dm_channel_xyz', 'Pick an agent:', [
        { customId: 'messenger:switch:agt_1', isPrimary: true, label: '✓ Inbox' },
        { customId: 'messenger:switch:agt_2', isPrimary: false, label: 'Coding' },
      ]);
    });
  });

  describe('updateAgentPicker', () => {
    it('edits the previously-sent picker message in place', async () => {
      const binder = new MessengerDiscordBinder();
      await binder.updateAgentPicker('dm_channel_xyz', 'picker_1', {
        entries: [
          { id: 'agt_1', isActive: false, title: 'Inbox' },
          { id: 'agt_2', isActive: true, title: 'Coding' },
        ],
        text: 'Pick an agent:',
      });

      expect(editMessageWithButtons).toHaveBeenCalledWith(
        'dm_channel_xyz',
        'picker_1',
        'Pick an agent:',
        [
          { customId: 'messenger:switch:agt_1', isPrimary: false, label: 'Inbox' },
          { customId: 'messenger:switch:agt_2', isPrimary: true, label: '✓ Coding' },
        ],
      );
    });
  });
});
