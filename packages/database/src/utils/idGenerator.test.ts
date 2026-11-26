import { describe, expect, it, vi } from 'vitest';

import { fileShares } from '../schemas/fileShare';
import { goalShares } from '../schemas/goalShare';
import { topicShares } from '../schemas/topic';
import { generateShareToken, idGenerator } from './idGenerator';

describe('idGenerator', () => {
  it('should generate an ID with the correct prefix and length', () => {
    const fileId = idGenerator('files');
    expect(fileId).toMatch(/^file_[\dA-Za-z]{12}$/);

    const messageId = idGenerator('messages');
    expect(messageId).toMatch(/^msg_[\dA-Za-z]{12}$/);

    const pluginId = idGenerator('plugins');
    expect(pluginId).toMatch(/^plg_[\dA-Za-z]{12}$/);

    const sessionGroupId = idGenerator('sessionGroups');
    expect(sessionGroupId).toMatch(/^sg_[\dA-Za-z]{12}$/);

    const sessionId = idGenerator('sessions');
    expect(sessionId).toMatch(/^ssn_[\dA-Za-z]{12}$/);

    const topicId = idGenerator('topics');
    expect(topicId).toMatch(/^tpc_[\dA-Za-z]{12}$/);

    const userId = idGenerator('user');
    expect(userId).toMatch(/^user_[\dA-Za-z]{12}$/);

    expect(idGenerator('channels')).toMatch(/^chn_[\dA-Za-z]{12}$/);
    expect(idGenerator('channelThreads')).toMatch(/^cht_[\dA-Za-z]{12}$/);
  });

  it('should generate an ID with custom size', () => {
    const fileId = idGenerator('files', 12);
    expect(fileId).toMatch(/^file_[\dA-Za-z]{12}$/);
  });

  it('should throw an error for invalid namespace', () => {
    expect(() => idGenerator('invalid' as any)).toThrowError(
      'Invalid namespace: invalid, please check your code.',
    );
  });
});

describe('generateShareToken', () => {
  it('should draw from the platform CSPRNG', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');

    generateShareToken();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('should carry at least 128 bits of entropy in a URL-safe alphabet', () => {
    const token = generateShareToken();

    expect(token).toMatch(/^[\w-]{22}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
  });

  it('should not collide across many generations', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(tokens.size).toBe(1000);
  });

  it.each([
    ['topicShares', topicShares],
    ['fileShares', fileShares],
    ['goalShares', goalShares],
  ])('should back the %s id default', (_name, table) => {
    const token = table.id.defaultFn!() as string;

    expect(token).toMatch(/^[\w-]{22}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
  });
});
