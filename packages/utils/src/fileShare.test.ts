import { describe, expect, it } from 'vitest';

import { fileSharePath, fileShareUrl } from './fileShare';

describe('fileShareUrl', () => {
  it('builds the share page address on the given origin', () => {
    expect(fileShareUrl('https://lobehub.com/', 'Ab3_x')).toBe(
      'https://lobehub.com/share/file/Ab3_x',
    );
  });

  it('encodes the share id', () => {
    expect(fileSharePath('a/b')).toBe('/share/file/a%2Fb');
  });
});
