import { describe, expect, it } from 'vitest';

import { getPlatformLabel } from './getDeviceIcon';

describe('getPlatformLabel', () => {
  it('names known platforms and appends the architecture', () => {
    expect(getPlatformLabel('darwin', 'arm64')).toBe('macOS · arm64');
    expect(getPlatformLabel('win32')).toBe('Windows');
  });

  it('keeps an unknown platform verbatim', () => {
    expect(getPlatformLabel('freebsd', 'x64')).toBe('freebsd · x64');
  });

  it('returns undefined when nothing is known', () => {
    expect(getPlatformLabel(null, null)).toBeUndefined();
  });
});
