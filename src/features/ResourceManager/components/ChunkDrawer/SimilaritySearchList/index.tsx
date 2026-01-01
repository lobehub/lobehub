import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { useFileStore } from '@/store/file';

import SkeletonLoading from '../Loading';
import ChunkItem from './Item';

const SimilaritySearchList = memo(() => {
  const isSimilaritySearching = useFileStore((s) => s.isSimilaritySearching);
  const dataSource = useFileStore((s) => s.similaritySearchChunks, isEqual);

  return isSimilaritySearching ? (
    <SkeletonLoading />
  ) : (
    <Flexbox flex={1}>
      <Virtuoso
        data={dataSource}
        itemContent={(index, item) => (
          <Flexbox key={item.id} paddingInline={12}>
            <ChunkItem {...item} index={index} />
          </Flexbox>
        )}
      />
    </Flexbox>
  );
});

export default SimilaritySearchList;
