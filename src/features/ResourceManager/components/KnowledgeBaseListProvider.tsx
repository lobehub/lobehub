'use client';

import type { PropsWithChildren } from 'react';
import { createContext, memo, use, useMemo } from 'react';

import { useKnowledgeBaseStore } from '@/store/library';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

const KnowledgeBaseListContext = createContext<KnowledgeBaseItem[] | null>(null);

export const KnowledgeBaseListProvider = memo<PropsWithChildren>(({ children }) => {
  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data } = useFetchKnowledgeBaseList();

  const knowledgeBases = useMemo(() => data ?? [], [data]);

  return <KnowledgeBaseListContext value={knowledgeBases}>{children}</KnowledgeBaseListContext>;
});

KnowledgeBaseListProvider.displayName = 'KnowledgeBaseListProvider';

export const useKnowledgeBaseListContext = () => {
  const context = use(KnowledgeBaseListContext);

  if (!context) {
    throw new Error('useKnowledgeBaseListContext must be used within KnowledgeBaseListProvider');
  }

  return context;
};
