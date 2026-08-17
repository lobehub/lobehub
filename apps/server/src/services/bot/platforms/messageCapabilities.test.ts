import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from './messageCapabilities';

const HERE = dirname(fileURLToPath(import.meta.url));

// The `lobe-message` channel operations (bot/messenger-management APIs are
// intentionally out of scope — they're platform-independent).
const CHANNEL_APIS = [
  'sendMessage',
  'sendDirectMessage',
  'readMessages',
  'searchMessages',
  'editMessage',
  'deleteMessage',
  'reactToMessage',
  'getReactions',
  'pinMessage',
  'unpinMessage',
  'listPins',
  'getChannelInfo',
  'listChannels',
  'getMemberInfo',
  'createThread',
  'listThreads',
  'replyToThread',
  'createPoll',
];

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
  return CHANNEL_APIS.filter((api) => thrown.has(api) || !implemented.has(api)).sort();
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
