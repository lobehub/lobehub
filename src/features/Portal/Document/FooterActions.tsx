'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Download, MessageSquareText } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { agentDocumentService } from '@/services/agentDocument';
import { documentService } from '@/services/document';
import { useChatStore } from '@/store/chat';
import { useDocumentStore } from '@/store/document';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;

    padding-block: 12px;
    padding-block-end: calc(12px + env(safe-area-inset-bottom));
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

interface FooterActionsProps {
  agentId: string;
  documentId: string;
  title?: string;
}

/**
 * Compact portal footer: two entry buttons that replace the inline
 * conversation input. "Chat to edit" jumps the main conversation to the
 * doc-anchored chat topic (created on demand via `getOrCreateChatTopic`);
 * "Export" downloads the current markdown content.
 */
const FooterActions = memo<FooterActionsProps>(({ agentId, documentId, title }) => {
  const { t } = useTranslation(['chat', 'file', 'common']);

  const switchTopic = useChatStore((s) => s.switchTopic);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);

  // The editor canvas keeps the live buffer in the document store; the SWR
  // meta reflects the last persisted markdown. Prefer the store (fresher) —
  // including an intentionally emptied buffer — and fall back to the SWR copy
  // only while the editor has not produced a buffer for this document.
  const storeContent = useDocumentStore((s) => s.documents[documentId]?.content);
  const { data: documentMeta } = useClientDataSWR(
    documentId ? portalKeys.documentHeader(documentId) : null,
    () => documentService.getDocumentById(documentId!),
  );
  const markdown = storeContent ?? documentMeta?.content ?? '';

  const handleChatToEdit = useCallback(async () => {
    try {
      const result = await agentDocumentService.getOrCreateChatTopic({ agentId, documentId });
      // Return to the main conversation anchored on this document's chat topic —
      // the portal closes so the topic surface takes over.
      clearPortalStack();
      await switchTopic(result.topicId);
    } catch {
      toast.error(t('operationFailed', { ns: 'common' }));
    }
  }, [agentId, clearPortalStack, documentId, switchTopic, t]);

  const handleExport = useCallback(async () => {
    const content = markdown;
    const fileName = `${title || 'Untitled'}.md`;
    try {
      if (isDesktop) {
        const { desktopExportService } = await import('@/services/electron/desktopExportService');
        await desktopExportService.exportMarkdown({ content, fileName });
      } else {
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        toast.success(t('pageEditor.exportSuccess', { ns: 'file' }));
      }
    } catch {
      toast.error(t('pageEditor.exportError', { ns: 'file' }));
    }
  }, [markdown, t, title]);

  return (
    <Flexbox horizontal className={styles.root} gap={8}>
      <Button
        block
        icon={MessageSquareText}
        type={'default'}
        onClick={() => void handleChatToEdit()}
      >
        {t('agentDocument.portal.chatWithDocument', { ns: 'chat' })}
      </Button>
      <Button block icon={Download} type={'default'} onClick={() => void handleExport()}>
        {t('agentDocument.portal.export', { ns: 'chat' })}
      </Button>
    </Flexbox>
  );
});

FooterActions.displayName = 'PortalDocumentFooterActions';

export default FooterActions;
