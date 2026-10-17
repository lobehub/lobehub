'use client';

import { isDesktop } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { useDocumentStore } from '@/store/document';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';

/**
 * Downloads the portal document as Markdown. Returns `undefined` until the
 * document has loaded, and for a file-backed document: its data lives behind
 * `fileId` with an empty markdown `content`, so the export would download an
 * empty file (the standalone page menu hides export on the same condition).
 */
export const useMarkdownExport = (documentId: string | undefined) => {
  const { t } = useTranslation('file');

  // The editor canvas keeps the live buffer in the document store; the SWR
  // meta reflects the last persisted markdown. Prefer the store (fresher) —
  // including an intentionally emptied buffer — and fall back to the SWR copy
  // only while the editor has not produced a buffer for this document.
  const storeContent = useDocumentStore((s) =>
    documentId ? s.documents[documentId]?.content : undefined,
  );
  const { data: documentMeta } = useClientDataSWR(
    documentId ? portalKeys.documentHeader(documentId) : null,
    () => documentService.getDocumentById(documentId!),
  );

  if (!documentMeta || getDocumentRenderMode(documentMeta).mode === 'file') return;

  return async () => {
    const content = storeContent ?? documentMeta.content ?? '';
    const baseName = documentMeta.title || documentMeta.filename || 'Untitled';
    // Agent-written titles often carry the extension already (`notes.md`).
    const fileName = /\.md$/i.test(baseName) ? baseName : `${baseName}.md`;
    try {
      if (isDesktop) {
        const { desktopExportService } = await import('@/services/electron/desktopExportService');
        await desktopExportService.exportMarkdown({ content, fileName });
        return;
      }
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(t('pageEditor.exportSuccess'));
    } catch {
      toast.error(t('pageEditor.exportError'));
    }
  };
};
