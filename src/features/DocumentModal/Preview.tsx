'use client';

import { memo, useEffect } from 'react';

import { useDocumentStore } from '@/store/document';

import DocumentModal from '.';

/**
 * Mount this once per route surface that should render the global document
 * preview modal. Connects to `useDocumentStore.previewDocumentId` and clears
 * that state on unmount, so navigating away with the modal open doesn't
 * leak a stale id into the next surface that mounts a preview modal.
 */
const DocumentPreviewModal = memo(() => {
  const previewDocumentId = useDocumentStore((s) => s.previewDocumentId);
  const closeDocumentPreview = useDocumentStore((s) => s.closeDocumentPreview);

  // Route-teardown cleanup: previewDocumentId is global, so a stale value
  // would reopen on the next surface mount. Action is a no-op when already
  // empty, so this is safe to fire unconditionally.
  useEffect(() => () => closeDocumentPreview(), [closeDocumentPreview]);

  return (
    <DocumentModal
      documentId={previewDocumentId}
      open={!!previewDocumentId}
      onClose={closeDocumentPreview}
    />
  );
});

DocumentPreviewModal.displayName = 'DocumentPreviewModal';

export default DocumentPreviewModal;
