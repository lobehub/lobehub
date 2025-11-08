'use client';

import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { useParams } from 'react-router-dom';

import FileModalQueryRoute from '@/app/[variants]/(main)/knowledge/shared/FileModalQueryRoute';
import { useSetFileModalId } from '@/app/[variants]/(main)/knowledge/shared/useFileQueryParam';
import FileManager from '@/features/FileManager';
import FilePanel from '@/features/FileSidePanel';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/knowledgeBase';

import { useKnowledgeBaseItem } from '../../hooks/useKnowledgeItem';
import Menu from './menu/Menu';

/**
 * Knowledge Base Detail Page
 * Shows file list for a specific knowledge base
 * Supports ?file=[fileId] query param for file preview modal
 */
const KnowledgeBaseDetailPage = memo(() => {
  const { id } = useParams<{ id: string }>();
  const setFileModalId = useSetFileModalId();

  useKnowledgeBaseItem(id!);
  const name = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseNameById(id!));

  if (!id) {
    return <div>Knowledge base ID is required</div>;
  }

  return (
    <>
      <FilePanel>
        <Menu id={id} />
      </FilePanel>
      <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }}>
        <FileManager knowledgeBaseId={id} onOpenFile={setFileModalId} title={name} />
      </Flexbox>
      <FileModalQueryRoute />
    </>
  );
});

KnowledgeBaseDetailPage.displayName = 'KnowledgeBaseDetailPage';

export default KnowledgeBaseDetailPage;
