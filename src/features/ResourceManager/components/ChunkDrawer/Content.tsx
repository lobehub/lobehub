import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';

import { useFileStore } from '@/store/file';
import { fileChunkSelectors } from '@/store/file/slices/chunk';

import ChunkList from './ChunkList';
import SimilaritySearchList from './SimilaritySearchList';

const Content = memo(() => {
  const [fileId, showSimilaritySearch, semanticSearch] = useFileStore((s) => [
    fileChunkSelectors.enabledChunkFileId(s),
    fileChunkSelectors.showSimilaritySearchResult(s),
    s.semanticSearch,
  ]);

  if (!fileId) return;

  return (
    <Flexbox gap={8} height={'100%'} paddingBlock={'16px 0'}>
      <Flexbox paddingInline={12}>
        <SearchBar
          variant={'filled'}
          onChange={(text) => {
            if (!text) useFileStore.setState({ isSimilaritySearch: false });
          }}
          onSearch={async (text) => {
            useFileStore.setState({ isSimilaritySearch: !!text });
            semanticSearch(text, fileId);
          }}
        />
      </Flexbox>
      {showSimilaritySearch ? <SimilaritySearchList /> : <ChunkList fileId={fileId} />}
    </Flexbox>
  );
});

export default Content;
