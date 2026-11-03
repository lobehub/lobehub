import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { lambdaQuery } from '@/libs/trpc/client';

import SkeletonLoading from '../Loading';
import ChunkItem from './ChunkItem';

interface ChunkListProps {
  fileId: string;
}
const ChunkList = memo<ChunkListProps>(({ fileId }) => {
  const { data, isLoading, fetchNextPage } = lambdaQuery.chunk.getChunksByFileId.useInfiniteQuery(
    { id: fileId },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  const dataSource = data?.pages.flatMap((page) => page.items) || [];

  return isLoading ? (
    <SkeletonLoading />
  ) : (
    <Flexbox flex={1}>
      <Virtuoso
        data={dataSource}
        endReached={() => {
          fetchNextPage();
        }}
        itemContent={(index, item) => (
          <Flexbox key={item.id} paddingInline={12}>
            <ChunkItem {...item} index={index} />
          </Flexbox>
        )}
      />
    </Flexbox>
  );
});

export default ChunkList;
