import { describe, expect, it } from 'vitest';

import { isRemoteLocalFile } from './helpers';

describe('isRemoteLocalFile', () => {
  const file = { filePath: '/work/index.html', workingDirectory: '/work' };

  it.each([
    ['local', file, false],
    ['remote device', { ...file, deviceId: 'remote-device' }, true],
    ['cloud sandbox', { ...file, sandboxTopicId: 'topic-a' }, true],
    ['missing', undefined, false],
  ])('identifies a %s file', (_label, entry, expected) => {
    expect(isRemoteLocalFile(entry)).toBe(expected);
  });
});
