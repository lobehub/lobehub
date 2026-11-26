import { describe, expect, it } from 'vitest';

import { libraryFavoriteTarget } from './libraryFavorite';

describe('libraryFavoriteTarget', () => {
  it('favorites the library root under its id', () => {
    expect(libraryFavoriteTarget({ avatar: '📚', id: 'kb_1', name: 'Docs' })).toEqual({
      icon: '📚',
      path: '/resource/library/kb_1',
      targetId: 'kb_1',
      title: 'Docs',
      type: 'library',
    });
  });

  it('falls back to the type icon when the library has no avatar', () => {
    expect(libraryFavoriteTarget({ avatar: null, id: 'kb_2', name: 'Notes' }).icon).toBeNull();
    expect(libraryFavoriteTarget({ avatar: '', id: 'kb_2', name: 'Notes' }).icon).toBeNull();
  });
});
