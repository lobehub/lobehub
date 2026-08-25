import { describe, expect, it } from 'vitest';

import { getLibraryIconVariant } from './StatusIcon';

describe('getLibraryIconVariant', () => {
  it('uses a plain lock for private libraries', () => {
    expect(getLibraryIconVariant({ memberRestricted: true, visibility: 'private' })).toBe(
      'private',
    );
  });

  it('uses a folder with a lock for member-restricted workspace libraries', () => {
    expect(getLibraryIconVariant({ memberRestricted: true, visibility: 'public' })).toBe(
      'restricted',
    );
  });

  it('uses a plain folder for ordinary workspace libraries', () => {
    expect(getLibraryIconVariant({ memberRestricted: false, visibility: 'public' })).toBe(
      'workspace',
    );
  });
});
