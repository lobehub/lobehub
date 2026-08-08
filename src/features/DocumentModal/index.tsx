'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { PageAgentPanelOverrideProvider } from '@/features/PageEditor/RightPanel/OverrideContext';
import PageExplorer from '@/features/PageExplorer';

import DocumentModalHeader from './Header';

interface DocumentModalContentProps {
  documentId: string;
}

const DocumentModalContent = memo<DocumentModalContentProps>(({ documentId }) => {
  return (
    <PageAgentPanelOverrideProvider defaultExpand={false}>
      <PageExplorer fullWidthHeader header={<DocumentModalHeader />} pageId={documentId} />
    </PageAgentPanelOverrideProvider>
  );
});

DocumentModalContent.displayName = 'DocumentModalContent';

export const createDocumentModal = (documentId: string) =>
  createModal({
    content: <DocumentModalContent documentId={documentId} />,
    footer: null,
    maskClosable: true,
    styles: {
      content: {
        display: 'flex',
        height: '92vh',
        minHeight: 0,
        overflow: 'hidden',
        padding: 0,
      },
    },
    width: 'min(95vw, 1600px)',
  });
