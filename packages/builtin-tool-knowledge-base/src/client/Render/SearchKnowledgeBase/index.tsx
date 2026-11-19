'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Empty, Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { SearchKnowledgeBaseArgs, SearchKnowledgeBaseState } from '../../../types';
import FileItem from './Item';

const SearchKnowledgeBase = memo<
  BuiltinRenderProps<SearchKnowledgeBaseArgs, SearchKnowledgeBaseState>
>(({ pluginState }) => {
  const { t } = useTranslation('plugin');
  const { documents, fileResults, scope } = pluginState || {};

  // Nothing was searched — saying "No results" would read as "the files don't
  // contain it" when the agent simply has no library to look in.
  if (scope === 'none') {
    return <Empty description={t('builtins.lobe-knowledge-base.render.noScope')} />;
  }

  // Keyword matches (`documents`) are hits too; a card listing only the
  // vector matches would read "No results" while the model got pages back.
  const fileHits = fileResults ?? [];
  const documentHits = documents ?? [];

  if (fileHits.length === 0 && documentHits.length === 0) {
    return <Empty description={t('builtins.lobe-knowledge-base.inspector.noResults')} />;
  }

  return (
    <Flexbox horizontal gap={8} wrap={'wrap'}>
      {fileHits.map((file, index) => (
        <FileItem
          fileId={file.fileId}
          fileName={file.fileName}
          index={index}
          key={file.fileId}
          relevanceScore={file.relevanceScore}
        />
      ))}
      {documentHits.map((doc, index) => (
        <FileItem
          fileId={doc.documentId}
          fileName={doc.title}
          index={fileHits.length + index}
          key={doc.documentId}
        />
      ))}
    </Flexbox>
  );
});

export default SearchKnowledgeBase;
