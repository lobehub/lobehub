import type { UniformSearchResult } from '@lobechat/types';
import React, { memo, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { SEARCH_ITEM_LIMITED_COUNT } from '../../../../const';
import Item from './SearchItem';

interface ResultListProps {
  dataSources: UniformSearchResult[];
}

const ResultList = memo<ResultListProps>(({ dataSources }) => {
  const itemContent = useCallback(
    (index: number, result: UniformSearchResult) => (
      <Item {...result} highlight={index < SEARCH_ITEM_LIMITED_COUNT} />
    ),
    [],
  );

  return <Virtuoso data={dataSources} height={'100%'} itemContent={itemContent} />;
});

export default ResultList;
