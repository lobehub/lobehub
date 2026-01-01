'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { ComponentType, memo } from 'react';

import { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../../types';
import FileItem from './Item';

export interface SearchKnowledgeBaseRenderProps extends Pick<
  BuiltinRenderProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>,
  'pluginState'
> {
  FileIcon: ComponentType<{ fileName: string; size: number; variant?: 'raw' | 'file' | 'folder' }>;
  isMobile?: boolean;
  onFileClick?: (params: { chunkId: string; chunkText: string; fileId: string }) => void;
}

const SearchKnowledgeBase = memo<SearchKnowledgeBaseRenderProps>(
  ({ pluginState, FileIcon, isMobile, onFileClick }) => {
    const { fileResults } = pluginState || {};

    return (
      <Flexbox gap={8} horizontal wrap={'wrap'}>
        {fileResults?.map((file, index) => {
          return (
            <FileItem
              FileIcon={FileIcon}
              index={index}
              isMobile={isMobile}
              key={file.fileId}
              onFileClick={onFileClick}
              {...file}
            />
          );
        })}
      </Flexbox>
    );
  },
);

export default SearchKnowledgeBase;
