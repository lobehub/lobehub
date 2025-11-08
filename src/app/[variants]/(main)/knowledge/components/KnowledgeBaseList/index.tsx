import React from 'react';
import { Flexbox } from 'react-layout-kit';
import { Virtuoso } from 'react-virtuoso';

import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

import KnowledgeBaseItem from '../KnowledgeBaseItem';
import EmptyStatus from './EmptyStatus';
import { SkeletonList } from './SkeletonList';

const KnowledgeBaseList = () => {
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data, isLoading } = useFetchKnowledgeBaseList();

  if (isLoading) return <SkeletonList />;

  if (data?.length === 0) return <EmptyStatus />;

  return (
    <Flexbox height={'100%'}>
      <Virtuoso
        data={data}
        fixedItemHeight={36}
        itemContent={(index, item) => (
          <KnowledgeBaseItem id={item.id} key={item.id} name={item.name} />
        )}
      />
    </Flexbox>
  );
};

export default KnowledgeBaseList;
