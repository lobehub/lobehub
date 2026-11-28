// @vitest-environment node
import type { CollectionWorkVersionMetadata } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectionCoverUrl } from '../collection';

const item = (fileId: string, url: string) => ({ fileId, url });

describe('collectionCoverUrl', () => {
  it('prefers the named cover image', () => {
    const collection: CollectionWorkVersionMetadata = {
      coverFileId: 'file-b',
      items: [item('file-a', '/f/file-a'), item('file-b', '/f/file-b')],
    };

    expect(collectionCoverUrl(collection)).toBe('/f/file-b');
  });

  it('falls back to the first image when no cover is named or the named one is gone', () => {
    expect(collectionCoverUrl({ items: [item('file-a', '/f/file-a')] })).toBe('/f/file-a');
    expect(
      collectionCoverUrl({
        coverFileId: 'file-missing',
        items: [item('file-a', '/f/file-a')],
      }),
    ).toBe('/f/file-a');
  });

  it('returns null for an empty collection instead of an undefined url', () => {
    expect(collectionCoverUrl({ items: [] })).toBeNull();
  });
});
