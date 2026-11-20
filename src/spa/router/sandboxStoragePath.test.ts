import { describe, expect, it } from 'vitest';

import { legacySandboxStoragePath } from './sandboxStoragePath';

describe('legacySandboxStoragePath', () => {
  it.each([
    ['/settings/drive', '/resource/sandbox-storage'],
    ['/settings/drive/', '/resource/sandbox-storage'],
    ['/acme/settings/drive', '/acme/resource/sandbox-storage'],
  ])('%s → %s', (from, to) => {
    expect(legacySandboxStoragePath(from)).toBe(to);
  });
});
