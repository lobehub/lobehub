'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { LobeAnalyticsProviderWrapper } from '@/components/Analytics/LobeAnalyticsProviderWrapper';
import { PageAgentPanelOverrideProvider } from '@/features/PageEditor/RightPanel/OverrideContext';
import PageExplorer from '@/features/PageExplorer';

import DocumentModalHeader from './Header';

interface DocumentModalContentProps {
  documentId: string;
}

const DocumentModalContent = memo<DocumentModalContentProps>(({ documentId }) => {
  return (
    <LobeAnalyticsProviderWrapper>
      <PageAgentPanelOverrideProvider defaultExpand={false}>
        <PageExplorer fullWidthHeader header={<DocumentModalHeader />} pageId={documentId} />
      </PageAgentPanelOverrideProvider>
    </LobeAnalyticsProviderWrapper>
  );
});

DocumentModalContent.displayName = 'DocumentModalContent';

/**
 * Opens a Document-backed Page in the shared full-size preview modal.
 *
 * Use when:
 * - A supporting surface needs in-context Document or Page inspection.
 * - Navigation away from the current task would interrupt the user's flow.
 *
 * Expects:
 * - `documentId` identifies a Document visible to the current user.
 *
 * Returns:
 * - The imperative modal instance created by the global modal host.
 */
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
