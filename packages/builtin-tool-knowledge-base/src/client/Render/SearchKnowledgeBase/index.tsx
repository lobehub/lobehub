'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Empty, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../../types';
import { getDocumentOnlyHits } from './getDocumentOnlyHits';
import FileItem from './Item';

const SearchKnowledgeBase = memo<
  BuiltinRenderProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');
  const { fileResults, scope } = pluginState || {};

  // Nothing was searched — saying "No results" would read as "the files don't
  // contain it" when the agent simply has no library to look in.
  if (scope === 'none') {
    return <Empty description={t('builtins.lobe-knowledge-base.render.noScope')} />;
  }

  const documentHits = getDocumentOnlyHits(pluginState);

  if (!fileResults?.length && documentHits.length === 0) {
    return <Empty description={t('builtins.lobe-knowledge-base.inspector.noResults')} />;
  }

  return (
    <Flexbox horizontal gap={8} wrap={'wrap'}>
      {fileResults?.map((file) => (
        <FileItem fileName={file.fileName} key={file.fileId} relevanceScore={file.relevanceScore} />
      ))}
      {documentHits.map((document) => (
        <FileItem fileName={document.title} key={document.documentId} />
      ))}
    </Flexbox>
  );
});

export default SearchKnowledgeBase;
