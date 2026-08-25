import { describe, expect, it } from 'vitest';

import { resolveResourcePathCategory } from './index';

describe('resolveResourcePathCategory', () => {
  it.each(['all', 'documents', 'images', 'videos', 'audios', 'files', 'page'])(
    'recovers the %s category for a static resource route',
    (category) => {
      expect(resolveResourcePathCategory(undefined, `/resource/${category}`)).toBe(category);
    },
  );

  it('preserves a dynamic category param when one exists', () => {
    expect(resolveResourcePathCategory('websites', '/resource/websites')).toBe('websites');
  });

  it('keeps the resource dashboard uncategorized', () => {
    expect(resolveResourcePathCategory(undefined, '/resource')).toBeUndefined();
  });
});
