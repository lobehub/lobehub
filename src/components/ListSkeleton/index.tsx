'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

interface ListSkeletonProps {
  /**
   * Inline padding of each placeholder row — match whatever the real row uses
   * so loading → loaded is a content swap, not a relayout (ux §4.1).
   */
  paddingInline?: number;
  rows?: number;
}

/**
 * Placeholder for a list of icon + title + subtitle rows (devices, credentials,
 * …). Skeletonises only the row text and leaves the surrounding card chrome to
 * the caller, so the list keeps its shape while the fetch is in flight.
 */
const ListSkeleton = memo<ListSkeletonProps>(({ paddingInline = 12, rows = 4 }) => (
  <Flexbox gap={2} width={'100%'}>
    {Array.from({ length: rows }, (_, index) => (
      <Flexbox
        horizontal
        align={'center'}
        gap={16}
        key={index}
        style={{ paddingBlock: 12, paddingInline }}
      >
        <Skeleton.Avatar shape={'square'} size={48} />
        <Flexbox flex={1} gap={8}>
          <Skeleton height={14} width={140} />
          <Skeleton height={12} width={200} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
));

ListSkeleton.displayName = 'ListSkeleton';

export default ListSkeleton;
