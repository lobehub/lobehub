import { describe, expect, it } from 'vitest';

import { FilesTabs } from '@/types/files';

import { isResourceCategoryActive } from './categoryActive';

const home = { key: FilesTabs.Home, url: '/resource' };

describe('isResourceCategoryActive', () => {
  it.each(['/resource', '/resource/', '/team/resource', '/team/resource/'])(
    'highlights Home on the resource dashboard at %s',
    (pathname) => {
      expect(isResourceCategoryActive(home, FilesTabs.Home, pathname)).toBe(true);
    },
  );

  it.each([
    '/resource/page',
    '/resource/page/',
    '/resource/images',
    '/resource/all',
    '/resource/works',
    '/resource/works/',
    '/resource/library/library-1',
    '/resource/library/library-1/permission',
    '/team/resource/page',
    '/team/resource/library/library-1',
  ])('does not highlight Home on %s when the store still selects Home', (pathname) => {
    expect(isResourceCategoryActive(home, FilesTabs.Home, pathname)).toBe(false);
  });

  it('preserves the selected file category', () => {
    expect(
      isResourceCategoryActive(
        { key: FilesTabs.Pages, url: '/resource/page' },
        FilesTabs.Pages,
        '/resource/page',
      ),
    ).toBe(true);
  });

  it('highlights Works and suppresses the stored file category on the gallery', () => {
    const pathname = '/team/resource/works';
    expect(
      isResourceCategoryActive({ key: 'works', url: '/resource/works' }, FilesTabs.Home, pathname),
    ).toBe(true);
    expect(
      isResourceCategoryActive(
        { key: FilesTabs.Pages, url: '/resource/page' },
        FilesTabs.Pages,
        pathname,
      ),
    ).toBe(false);
  });
});
