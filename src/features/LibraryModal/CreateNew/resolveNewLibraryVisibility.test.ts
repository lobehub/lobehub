import { describe, expect, it } from 'vitest';

import { resolveNewLibraryVisibility } from './resolveNewLibraryVisibility';

describe('resolveNewLibraryVisibility', () => {
  // The picker's Private tab creates a private library even though the Resources sidebar,
  // which the member is not looking at, still sits on its default workspace mode.
  it('keeps the scope the caller asked for', () => {
    expect(resolveNewLibraryVisibility('private', 'workspace')).toBe('private');
    expect(resolveNewLibraryVisibility('public', 'private')).toBe('public');
  });

  it('falls back to the Resources sidebar mode', () => {
    expect(resolveNewLibraryVisibility(undefined, 'private')).toBe('private');
    expect(resolveNewLibraryVisibility(undefined, 'workspace')).toBe('public');
  });
});
