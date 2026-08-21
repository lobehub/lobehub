import { describe, expect, it } from 'vitest';

import { artifactSharePath, artifactShareUrl } from './artifactShare';

describe('artifactShareUrl', () => {
  it('builds the product share path and URL', () => {
    expect(artifactSharePath('42')).toBe('/share/artifact/42');
    expect(artifactShareUrl('https://app.lobehub.com', '42')).toBe(
      'https://app.lobehub.com/share/artifact/42',
    );
    expect(artifactShareUrl('https://app.lobehub.com/', '42')).toBe(
      'https://app.lobehub.com/share/artifact/42',
    );
  });
});
