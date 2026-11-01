import { describe, expect, it } from 'vitest';

import { resolveResourceSkeletonView } from './skeletonView';

describe('resolveResourceSkeletonView', () => {
  it.each([
    ['/resource/drive', null, 'list'],
    ['/resource/drive/files', null, 'list'],
    ['/resource/drive/images', null, 'masonry'],
    ['/resource/drive/images', 'list', 'list'],
    ['/resource/works', null, 'works'],
    ['/team/resource/library', null, 'libraries'],
  ])('uses the settled view for %s', (pathname, requestedView, expected) => {
    expect(resolveResourceSkeletonView(pathname, requestedView)).toBe(expected);
  });
});
