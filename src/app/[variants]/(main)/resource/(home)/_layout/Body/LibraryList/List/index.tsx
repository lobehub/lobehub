'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useKnowledgeBaseStore } from '@/store/knowledgeBase';

import Item from './Item';

const KnowledgeBaseListView = memo(() => {
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data } = useFetchKnowledgeBaseList();

  if (!data || data.length === 0) return null;

  return (
    <Flexbox gap={1} paddingInline={4}>
      {data.map((item) => (
        <Item id={item.id} key={item.id} name={item.name} />
      ))}
    </Flexbox>
  );
});

export default KnowledgeBaseListView;
