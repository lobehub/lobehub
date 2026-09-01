import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveMessageManifest } from '@lobechat/builtin-tool-message';
import { describe, expect, it } from 'vitest';

import {
  CHANNEL_MESSAGE_APIS,
  PLATFORM_UNSUPPORTED_MESSAGE_APIS,
  resolveUnsupportedMessageApis,
  TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS,
} from './messageCapabilities';

const HERE = dirname(fileURLToPath(import.meta.url));

const GUEST_THREAD_ID = 'telegram:guest:-100123:bot:bot-1:message:10';
const MEMBER_THREAD_ID = 'telegram:-100123';

// platform id -> service.ts location (lark shares feishu's service)
const SERVICE_DIR: Record<string, string> = {
  discord: 'discord',
  feishu: 'feishu',
  imessage: 'imessage',
  lark: 'feishu',
  qq: 'qq',
  slack: 'slack',
  telegram: 'telegram',
  wechat: 'wechat',
};

/**
 * Derive the real unsupported channel APIs from the service source: ops that
 * throw `PlatformUnsupportedError`, plus optional methods that aren't implemented
 * at all (the execution runtime rejects those generically). This is the runtime
 * source of truth — the declared map must match it.
 */
const deriveUnsupported = (serviceSource: string): string[] => {
  const thrown = new Set(
    [...serviceSource.matchAll(/PlatformUnsupportedError\([^,]+,\s*'([^']*)'/g)].map((m) => m[1]),
  );
  const implemented = new Set(
    [...serviceSource.matchAll(/(\w+)\s*=\s*async\s*\(/g)].map((m) => m[1]),
  );
  return CHANNEL_MESSAGE_APIS.filter((api) => thrown.has(api) || !implemented.has(api)).sort();
};

describe('PLATFORM_UNSUPPORTED_MESSAGE_APIS', () => {
  it.each(Object.keys(SERVICE_DIR))(
    'matches the actual runtime support of the %s service',
    (platformId) => {
      const source = readFileSync(join(HERE, SERVICE_DIR[platformId], 'service.ts'), 'utf8');
      const declared = [...(PLATFORM_UNSUPPORTED_MESSAGE_APIS[platformId] ?? [])].sort();
      expect(declared).toEqual(deriveUnsupported(source));
    },
  );

  it('marks readMessages unsupported exactly for the no-history platforms', () => {
    const noHistory = Object.entries(PLATFORM_UNSUPPORTED_MESSAGE_APIS)
      .filter(([, apis]) => apis.includes('readMessages'))
      .map(([id]) => id)
      .sort();
    expect(noHistory).toEqual(['qq', 'telegram', 'wechat']);
  });
});

describe('Telegram Guest Mode message capabilities', () => {
  it('disables every channel API and keeps bot/messenger management', () => {
    expect(TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS).toEqual([...CHANNEL_MESSAGE_APIS]);
    expect(TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS).toContain('sendMessage');
    expect(TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS).toContain('createPoll');
    expect(TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS).toContain('getMemberInfo');
    expect(TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS).not.toContain('listBots');
    expect(TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS).not.toContain('sendMessengerPush');
  });

  it('selects the guest overlay only for guest Telegram thread ids', () => {
    expect(resolveUnsupportedMessageApis('telegram', GUEST_THREAD_ID)).toEqual(
      TELEGRAM_GUEST_UNSUPPORTED_MESSAGE_APIS,
    );
    expect(resolveUnsupportedMessageApis('telegram', MEMBER_THREAD_ID)).toEqual(
      PLATFORM_UNSUPPORTED_MESSAGE_APIS.telegram,
    );
    expect(resolveUnsupportedMessageApis('telegram', MEMBER_THREAD_ID)).not.toContain(
      'sendMessage',
    );
    expect(resolveUnsupportedMessageApis('wechat')).toEqual(
      PLATFORM_UNSUPPORTED_MESSAGE_APIS.wechat,
    );
    expect(resolveUnsupportedMessageApis(undefined, GUEST_THREAD_ID)).toBeUndefined();
  });

  it('hides channel tools from the Guest Mode lobe-message manifest', () => {
    const result = resolveMessageManifest({
      botPlatform: {
        id: 'telegram',
        unsupportedMessageApis: resolveUnsupportedMessageApis('telegram', GUEST_THREAD_ID),
      },
    })!;
    const names = result.api.map((api) => api.name);

    for (const api of CHANNEL_MESSAGE_APIS) {
      expect(names).not.toContain(api);
    }
    expect(names).toContain('listBots');
    expect(names).toContain('sendMessengerPush');
    expect(result.systemRole).toContain('sendMessage');
  });
});
