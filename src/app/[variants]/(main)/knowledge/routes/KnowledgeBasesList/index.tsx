'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import PanelTitle from '@/components/PanelTitle';
import FilePanel from '@/features/FileSidePanel';

import KnowledgeBaseList from '../../components/KnowledgeBaseList';

/**
 * Knowledge Bases List Page
 * Shows all available knowledge bases
 */
const KnowledgeBasesListPage = memo(() => {
  const { t } = useTranslation('file');

  return (
    <>
      <FilePanel>
        <Flexbox gap={16} height={'100%'} paddingInline={8}>
          <PanelTitle title={t('knowledgeBase.title')} />
          <KnowledgeBaseList />
        </Flexbox>
      </FilePanel>
      <Flexbox
        align="center"
        flex={1}
        justify="center"
        style={{ overflow: 'hidden', position: 'relative' }}
      >
        <div>Select a knowledge base to view details</div>
      </Flexbox>
    </>
  );
});

KnowledgeBasesListPage.displayName = 'KnowledgeBasesListPage';

export default KnowledgeBasesListPage;
