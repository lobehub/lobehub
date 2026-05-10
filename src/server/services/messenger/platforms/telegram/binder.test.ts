// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramClientFactory } from '@/server/services/bot/platforms/telegram/client';

import { issueLinkToken } from '../../linkTokenStore';
import { MessengerTelegramBinder } from './binder';

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('@/config/messenger', () => ({
  getMessengerTelegramConfig: vi.fn(),
}));

vi.mock('../../linkTokenStore', () => ({
  issueLinkToken: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/telegram/api', () => ({
  TelegramApi: vi.fn(),
}));

vi.mock('@/server/services/bot/platforms/telegram/client', () => ({
  TelegramClientFactory: vi.fn(),
}));

const { getMessengerTelegramConfig } = await import('@/config/messenger');

const VALID_CONFIG = {
  botToken: 'tg-bot-token',
  botUsername: 'lobehub_bot',
  webhookSecret: 'tg-secret',
};

let sendMessage: ReturnType<typeof vi.fn>;
let sendMessageWithUrlButton: ReturnType<typeof vi.fn>;
let sendMessageWithCallbackKeyboard: ReturnType<typeof vi.fn>;
let editMessageWithCallbackKeyboard: ReturnType<typeof vi.fn>;
let answerCallbackQuery: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  sendMessageWithUrlButton = vi.fn().mockResolvedValue({ message_id: 2 });
  sendMessageWithCallbackKeyboard = vi.fn().mockResolvedValue({ message_id: 3 });
  editMessageWithCallbackKeyboard = vi.fn().mockResolvedValue(undefined);
  answerCallbackQuery = vi.fn().mockResolvedValue(undefined);

  vi.mocked(TelegramApi).mockImplementation(
    () =>
      ({
        answerCallbackQuery,
        editMessageWithCallbackKeyboard,
        sendMessage,
        sendMessageWithCallbackKeyboard,
        sendMessageWithUrlButton,
      }) as any,
  );

  vi.mocked(getMessengerTelegramConfig).mockResolvedValue(VALID_CONFIG as any);
  vi.mocked(issueLinkToken).mockResolvedValue('rand-tg-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MessengerTelegramBinder.createClient', () => {
  it('returns null when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const binder = new MessengerTelegramBinder();
    const client = await binder.createClient();
    expect(client).toBeNull();
    expect(TelegramClientFactory).not.toHaveBeenCalled();
  });

  it('builds a TelegramClient with the env-backed credentials', async () => {
    const fakeClient = { id: 'client' };
    const createClient = vi.fn().mockReturnValue(fakeClient);
    vi.mocked(TelegramClientFactory).mockImplementation(() => ({ createClient }) as any);

    const binder = new MessengerTelegramBinder();
    const client = await binder.createClient();

    expect(client).toBe(fakeClient);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'messenger-telegram',
        credentials: { botToken: 'tg-bot-token', secretToken: 'tg-secret' },
        platform: 'telegram',
      }),
      { appUrl: 'https://app.example.com' },
    );
  });

  it('falls back to empty webhook secret when not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce({
      botToken: 'tg',
    } as any);
    const createClient = vi.fn();
    vi.mocked(TelegramClientFactory).mockImplementation(() => ({ createClient }) as any);

    await new MessengerTelegramBinder().createClient();
    expect(createClient.mock.calls[0][0].credentials.secretToken).toBe('');
  });
});

describe('MessengerTelegramBinder.handleUnlinkedMessage', () => {
  it('issues a link token and posts the URL-button DM with the verify-im link', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.handleUnlinkedMessage({
      authorUserId: '12345',
      authorUserName: 'alice',
      chatId: 'C_DM',
      message: { id: 'm1' } as any,
    });

    expect(issueLinkToken).toHaveBeenCalledWith({
      platform: 'telegram',
      platformUserId: '12345',
      platformUsername: 'alice',
    });
    expect(sendMessageWithUrlButton).toHaveBeenCalledTimes(1);
    const [chatId, text, button] = sendMessageWithUrlButton.mock.calls[0];
    expect(chatId).toBe('C_DM');
    expect(text).toContain('Welcome to LobeHub');
    expect(button.text).toContain('Link Account');
    expect(button.url).toContain('https://app.example.com/verify-im');
    expect(button.url).toContain('im_type=telegram');
    expect(button.url).toContain('im_user_id=12345');
    expect(button.url).toContain('random_id=rand-tg-1');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to a plain text message with the link inline when APP_URL is localhost', async () => {
    const appMod = await import('@/envs/app');
    (appMod as any).appEnv.APP_URL = 'http://localhost:3010';

    try {
      const binder = new MessengerTelegramBinder();
      await binder.handleUnlinkedMessage({
        authorUserId: '12345',
        chatId: 'C_DM',
        message: { id: 'm1' } as any,
      });

      expect(sendMessageWithUrlButton).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [, text] = sendMessage.mock.calls[0];
      expect(text).toContain('http://localhost:3010/verify-im');
    } finally {
      (appMod as any).appEnv.APP_URL = 'https://app.example.com';
    }
  });

  it('apologises and bails when issueLinkToken throws (Redis down)', async () => {
    vi.mocked(issueLinkToken).mockRejectedValueOnce(new Error('redis offline'));

    const binder = new MessengerTelegramBinder();
    await binder.handleUnlinkedMessage({
      authorUserId: '12345',
      chatId: 'C_DM',
      message: { id: 'm1' } as any,
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'C_DM',
      expect.stringContaining('temporarily unavailable'),
    );
    expect(sendMessageWithUrlButton).not.toHaveBeenCalled();
  });

  it('no-ops when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const binder = new MessengerTelegramBinder();
    await binder.handleUnlinkedMessage({
      authorUserId: '12345',
      chatId: 'C_DM',
      message: { id: 'm1' } as any,
    });
    expect(issueLinkToken).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('no-ops when APP_URL is missing', async () => {
    const appMod = await import('@/envs/app');
    const original = (appMod as any).appEnv.APP_URL;
    (appMod as any).appEnv.APP_URL = '';

    try {
      const binder = new MessengerTelegramBinder();
      await binder.handleUnlinkedMessage({
        authorUserId: '12345',
        chatId: 'C_DM',
        message: { id: 'm1' } as any,
      });
      expect(issueLinkToken).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    } finally {
      (appMod as any).appEnv.APP_URL = original;
    }
  });
});

describe('MessengerTelegramBinder.notifyLinkSuccess', () => {
  it('sends a plain success message when no agent is set', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.notifyLinkSuccess({ platformUserId: '12345' });

    expect(sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('Linked successfully'),
    );
    expect(sendMessage.mock.calls[0][1]).toContain('Send /agents');
  });

  it('includes the active agent name (HTML-escaped) when provided', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.notifyLinkSuccess({
      activeAgentName: 'A & B <coding>',
      platformUserId: '12345',
    });

    const text = sendMessage.mock.calls[0][1];
    expect(text).toContain('<b>A &amp; B &lt;coding&gt;</b>');
  });

  it('swallows errors when sendMessage throws', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Forbidden: bot was blocked'));
    const binder = new MessengerTelegramBinder();
    await expect(binder.notifyLinkSuccess({ platformUserId: '12345' })).resolves.toBeUndefined();
  });

  it('no-ops when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const binder = new MessengerTelegramBinder();
    await binder.notifyLinkSuccess({ platformUserId: '12345' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('MessengerTelegramBinder.sendDmText', () => {
  it('HTML-escapes the text before sending', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.sendDmText('C_DM', '/agents <1>');
    expect(sendMessage).toHaveBeenCalledWith('C_DM', '/agents &lt;1&gt;');
  });

  it('swallows errors and stays silent', async () => {
    sendMessage.mockRejectedValueOnce(new Error('boom'));
    const binder = new MessengerTelegramBinder();
    await expect(binder.sendDmText('C_DM', 'hi')).resolves.toBeUndefined();
  });

  it('no-ops when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const binder = new MessengerTelegramBinder();
    await binder.sendDmText('C_DM', 'hi');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('MessengerTelegramBinder.sendAgentPicker', () => {
  it('renders entries as a callback keyboard with the messenger:switch prefix', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.sendAgentPicker('C_DM', {
      entries: [
        { id: 'agt_1', isActive: true, title: 'Inbox' },
        { id: 'agt_2', isActive: false, title: 'Coding' },
      ],
      text: 'Pick one',
    });

    expect(sendMessageWithCallbackKeyboard).toHaveBeenCalledWith('C_DM', 'Pick one', [
      [{ callback_data: 'messenger:switch:agt_1', text: '✅ Inbox' }],
      [{ callback_data: 'messenger:switch:agt_2', text: 'Coding' }],
    ]);
  });

  it('swallows errors', async () => {
    sendMessageWithCallbackKeyboard.mockRejectedValueOnce(new Error('boom'));
    const binder = new MessengerTelegramBinder();
    await expect(
      binder.sendAgentPicker('C_DM', { entries: [], text: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('no-ops when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const binder = new MessengerTelegramBinder();
    await binder.sendAgentPicker('C_DM', { entries: [], text: 'x' });
    expect(sendMessageWithCallbackKeyboard).not.toHaveBeenCalled();
  });
});

describe('MessengerTelegramBinder.extractCallbackAction', () => {
  const buildReq = (body: unknown): Request =>
    ({
      json: async () => body,
    }) as any;

  it('returns null when the body is not JSON', async () => {
    const req = {
      json: async () => {
        throw new Error('bad json');
      },
    } as any as Request;
    const binder = new MessengerTelegramBinder();
    expect(await binder.extractCallbackAction(req)).toBeNull();
  });

  it('returns null when the body is not a callback_query', async () => {
    const binder = new MessengerTelegramBinder();
    expect(await binder.extractCallbackAction(buildReq({ message: {} }))).toBeNull();
  });

  it('returns null when callback_data does not start with the messenger prefix', async () => {
    const binder = new MessengerTelegramBinder();
    const req = buildReq({
      callback_query: {
        chat_instance: 'x',
        data: 'other:noop',
        from: { id: 1 },
        id: 'cb1',
        message: { chat: { id: 100 }, message_id: 9 },
      },
    });
    expect(await binder.extractCallbackAction(req)).toBeNull();
  });

  it('returns the parsed action for our own messenger callbacks', async () => {
    const binder = new MessengerTelegramBinder();
    const req = buildReq({
      callback_query: {
        data: 'messenger:switch:agt_x',
        from: { id: 12_345 },
        id: 'cb1',
        message: { chat: { id: 100 }, message_id: 9 },
      },
    });
    expect(await binder.extractCallbackAction(req)).toEqual({
      callbackId: 'cb1',
      chatId: '100',
      data: 'messenger:switch:agt_x',
      fromUserId: '12345',
      messageId: 9,
    });
  });

  it('returns null when required fields are missing', async () => {
    const binder = new MessengerTelegramBinder();
    const req = buildReq({
      callback_query: {
        data: 'messenger:switch:agt_x',
        from: {}, // no id
        id: 'cb1',
        message: { chat: { id: 100 } },
      },
    });
    expect(await binder.extractCallbackAction(req)).toBeNull();
  });

  it('returns null when the body is not an object', async () => {
    const binder = new MessengerTelegramBinder();
    expect(await binder.extractCallbackAction(buildReq('string-body'))).toBeNull();
  });
});

describe('MessengerTelegramBinder.acknowledgeCallback', () => {
  it('edits the picker message and answers the callback', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.acknowledgeCallback(
      {
        callbackId: 'cb1',
        chatId: '100',
        data: 'messenger:switch:agt_1',
        fromUserId: '12345',
        messageId: 9,
      },
      {
        toast: 'Switched',
        updatedPicker: {
          entries: [{ id: 'agt_1', isActive: true, title: 'Inbox' }],
          text: 'Pick',
        },
      },
    );

    expect(editMessageWithCallbackKeyboard).toHaveBeenCalledWith('100', 9, 'Pick', [
      [{ callback_data: 'messenger:switch:agt_1', text: '✅ Inbox' }],
    ]);
    expect(answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Switched');
  });

  it('skips the picker edit when messageId is missing', async () => {
    const binder = new MessengerTelegramBinder();
    await binder.acknowledgeCallback(
      { callbackId: 'cb1', chatId: '100', data: 'x', fromUserId: '12345' },
      { toast: 'ok', updatedPicker: { entries: [], text: 't' } },
    );
    expect(editMessageWithCallbackKeyboard).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it('keeps going when the picker edit throws', async () => {
    editMessageWithCallbackKeyboard.mockRejectedValueOnce(new Error('boom'));
    const binder = new MessengerTelegramBinder();
    await binder.acknowledgeCallback(
      {
        callbackId: 'cb1',
        chatId: '100',
        data: 'x',
        fromUserId: '12345',
        messageId: 9,
      },
      { toast: 'ok', updatedPicker: { entries: [], text: 't' } },
    );
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it('swallows answerCallbackQuery errors', async () => {
    answerCallbackQuery.mockRejectedValueOnce(new Error('expired'));
    const binder = new MessengerTelegramBinder();
    await expect(
      binder.acknowledgeCallback(
        { callbackId: 'cb1', chatId: '100', data: 'x', fromUserId: '12345' },
        {},
      ),
    ).resolves.toBeUndefined();
  });

  it('no-ops when telegram is not configured', async () => {
    vi.mocked(getMessengerTelegramConfig).mockResolvedValueOnce(null);
    const binder = new MessengerTelegramBinder();
    await binder.acknowledgeCallback(
      { callbackId: 'cb1', chatId: '100', data: 'x', fromUserId: '12345' },
      {},
    );
    expect(answerCallbackQuery).not.toHaveBeenCalled();
  });
});
