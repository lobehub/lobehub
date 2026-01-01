'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../../types';
import FileItem from './Item';

const SearchKnowledgeBase = memo<
  BuiltinRenderProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ pluginState }) => {
  const { fileResults } = pluginState || {};

  return (
    <Flexbox gap={8} horizontal wrap={'wrap'}>
      {fileResults?.map((file, index) => {
        return <FileItem index={index} key={file.fileId} {...file} />;
      })}
    </Flexbox>
  );
});

export default SearchKnowledgeBase;
