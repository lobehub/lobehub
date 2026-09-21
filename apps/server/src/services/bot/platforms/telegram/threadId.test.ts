import { describe, expect, it } from 'vitest';

import {
  encodeGuestInlineMessageId,
  encodeGuestTelegramThreadId,
  getTelegramGuestAuthorLanguageCode,
  getTelegramGuestQueryId,
  isGuestTelegramThreadId,
  parseTelegramThreadId,
} from './threadId';

describe('parseTelegramThreadId', () => {
  it('parses a member chat id', () => {
    expect(parseTelegramThreadId('telegram:-100123')).toEqual({
      chatId: '-100123',
      guest: false,
      messageThreadId: undefined,
    });
  });

  it('parses a member forum topic', () => {
    expect(parseTelegramThreadId('telegram:-100123:42')).toEqual({
      chatId: '-100123',
      guest: false,
      messageThreadId: 42,
    });
  });

  it('parses a guest chat without treating the guest segment as the chat id', () => {
    expect(parseTelegramThreadId('telegram:guest:-100123')).toEqual({
      chatId: '-100123',
      guest: true,
      messageThreadId: undefined,
    });
  });

  it('parses a guest forum topic', () => {
    expect(parseTelegramThreadId('telegram:guest:-100123:7')).toEqual({
      chatId: '-100123',
      guest: true,
      messageThreadId: 7,
    });
  });

  it('parses a message-scoped guest invocation', () => {
    expect(parseTelegramThreadId('telegram:guest:-100123:bot:999:message:55:7')).toEqual({
      chatId: '-100123',
      guest: true,
      guestBotId: '999',
      guestMessageId: '55',
      messageThreadId: 7,
    });
  });

  it('parses legacy message-scoped guest invocations', () => {
    expect(parseTelegramThreadId('telegram:guest:-100123:message:55:7')).toEqual({
      chatId: '-100123',
      guest: true,
      guestMessageId: '55',
      messageThreadId: 7,
    });
  });
});

describe('isGuestTelegramThreadId / encode', () => {
  it('round-trips guest thread ids', () => {
    const id = encodeGuestTelegramThreadId('-100123', '999', 55, 9);
    expect(id).toBe('telegram:guest:-100123:bot:999:message:55:9');
    expect(isGuestTelegramThreadId(id)).toBe(true);
    expect(isGuestTelegramThreadId('telegram:-100123')).toBe(false);
  });

  it('encodes and decodes guest inline message ids', () => {
    expect(encodeGuestInlineMessageId('BAAAA')).toBe('guest-inline:BAAAA');
  });
});

describe('getTelegramGuestQueryId', () => {
  it('reads guest_query_id from message.raw', () => {
    expect(getTelegramGuestQueryId({ raw: { guest_query_id: 'gq-1' } })).toBe('gq-1');
    expect(getTelegramGuestQueryId({ raw: {} })).toBeUndefined();
    expect(getTelegramGuestQueryId(undefined)).toBeUndefined();
  });
});

describe('getTelegramGuestAuthorLanguageCode', () => {
  it('prefers the summoning user over the message sender', () => {
    expect(
      getTelegramGuestAuthorLanguageCode({
        raw: {
          from: { language_code: 'en' },
          guest_bot_caller_user: { language_code: 'zh-hans' },
        },
      }),
    ).toBe('zh-hans');
  });

  it('falls back to the message sender when no caller user is present', () => {
    expect(getTelegramGuestAuthorLanguageCode({ raw: { from: { language_code: 'pt-br' } } })).toBe(
      'pt-br',
    );
  });

  it('returns undefined for missing or malformed raw payloads', () => {
    expect(getTelegramGuestAuthorLanguageCode(undefined)).toBeUndefined();
    expect(getTelegramGuestAuthorLanguageCode({ raw: 'nope' })).toBeUndefined();
    expect(getTelegramGuestAuthorLanguageCode({ raw: { from: {} } })).toBeUndefined();
  });
});
