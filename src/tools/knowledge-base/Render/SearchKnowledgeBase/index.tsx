'use client';

import { SearchKnowledgeBase as BaseSearchKnowledgeBase } from '@lobechat/builtin-tool-knowledge-base/client';
import { type BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';

import type { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../index';

const SearchKnowledgeBase = memo<
  BuiltinRenderProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ pluginState }) => {
  const openFilePreview = useChatStore((s) => s.openFilePreview);
  const isMobile = useIsMobile();

  return (
    <BaseSearchKnowledgeBase
      FileIcon={FileIcon}
      isMobile={isMobile}
      onFileClick={openFilePreview}
      pluginState={pluginState}
    />
  );
});

export default SearchKnowledgeBase;
