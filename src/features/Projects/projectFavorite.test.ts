import { describe, expect, it } from 'vitest';

import { projectFavoriteTarget } from './projectFavorite';

describe('projectFavoriteTarget', () => {
  // A slug can be renamed from Project Settings, so the favorite keeps the id link.
  it('favorites the project under its id, not its renameable slug', () => {
    expect(projectFavoriteTarget({ avatar: '🚀', id: 'proj_1', name: 'LobeHub' })).toEqual({
      icon: '🚀',
      path: '/project/proj_1',
      targetId: 'proj_1',
      title: 'LobeHub',
      type: 'project',
    });
  });
});
