'use client';

import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useDocumentStore } from '@/store/document';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';
import { exportHtmlDocument } from '@/utils/exportTextFile';

/**
 * Downloads the portal document as a `.html` file. Returns `undefined` until
 * the document has loaded, and for anything but an HTML page (those export as
 * Markdown through `useMarkdownExport`).
 */
export const useHtmlExport = (documentId: string | undefined) => {
  const { t } = useTranslation('file');
  const useFetchDocumentDetail = useDocumentStore((s) => s.useFetchDocumentDetail);
  const { data: documentMeta } = useFetchDocumentDetail(documentId);

  if (!documentMeta || getDocumentRenderMode(documentMeta).mode !== 'html') return;

  return async () => {
    try {
      const result = await exportHtmlDocument(
        documentMeta.content ?? '',
        documentMeta.title || documentMeta.filename,
      );
      if (result === 'downloaded') toast.success(t('pageEditor.exportSuccess'));
    } catch (error) {
      console.error('[PortalDocument] Failed to export HTML:', error);
      toast.error(t('pageEditor.exportError'));
    }
  };
};
