import type { CollectionWorkVersionMetadata } from '@lobechat/types';

import { createDisplayWorkAdapter } from './displayWork';

export const collectionWorkAdapter = createDisplayWorkAdapter({ type: 'collection' });

/**
 * The image a collection card shows: the named cover, else the first image. List
 * rows carry no version metadata, so its URL is also denormalized into
 * `works.url`.
 */
export const collectionCoverUrl = (collection: CollectionWorkVersionMetadata): string | null => {
  const cover = collection.coverFileId
    ? collection.items.find((item) => item.fileId === collection.coverFileId)
    : undefined;
  return (cover ?? collection.items[0])?.url ?? null;
};
