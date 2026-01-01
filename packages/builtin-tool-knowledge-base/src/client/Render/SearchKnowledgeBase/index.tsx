'use client';

import { BuiltinRenderProps } from '@lobechat/types';
import { Empty, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../../types';
import FileItem from './Item';

const SearchKnowledgeBase = memo<
  BuiltinRenderProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');
  const { fileResults } = pluginState || {};

  if (!fileResults || fileResults.length === 0) {
    return <Empty description={t('builtins.lobe-knowledge-base.inspector.noResults')} />;
  }

  return (
    <Flexbox gap={8} horizontal wrap={'wrap'}>
      {fileResults.map((file, index) => {
        return <FileItem index={index} key={file.fileId} {...file} />;
      })}
    </Flexbox>
  );
});

export default SearchKnowledgeBase;
