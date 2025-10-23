import { Button } from '@lobehub/ui';
import { App } from 'antd';
import { DownloadIcon, FileText } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { ChatMessage } from '@/types/message';

import PdfPreview from './PdfPreview';
import { useContainerStyles, useStyles } from './style';
import { generateMarkdown } from './template';
import { usePdfGeneration } from './usePdfGeneration';

interface SharePdfProps {
  message: ChatMessage;
}

const SharePdf = memo<SharePdfProps>(({ message }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { styles } = useStyles();
  const { styles: containerStyles } = useContainerStyles();
  const { message: appMessage } = App.useApp();
  const isMobile = useIsMobile();

  // Get session info
  const activeId = useChatStore((s) => s.activeId);
  const topicId = useChatStore((s) => s.activeTopicId);

  // Generate markdown content for single message
  const markdownContent = generateMarkdown({
    message,
  }).replaceAll('\n\n\n', '\n');

  const { generatePdf, downloadPdf, pdfData, loading, error } = usePdfGeneration();

  const handleGeneratePdf = async () => {
    if (activeId && markdownContent.trim()) {
      await generatePdf({
        content: markdownContent,
        sessionId: activeId,
        topicId: topicId || undefined,
      });
    }
  };

  const handleDownload = async () => {
    if (pdfData) {
      try {
        await downloadPdf();
        appMessage.success(t('shareModal.downloadSuccess'));
      } catch {
        appMessage.error(t('shareModal.downloadError'));
      }
    }
  };

  const generateButton = (
    <Button
      block
      disabled={loading}
      icon={loading ? undefined : FileText}
      loading={loading}
      onClick={handleGeneratePdf}
      size={isMobile ? undefined : 'large'}
      type="primary"
    >
      {loading
        ? t('shareModal.generatingPdf')
        : pdfData
          ? t('shareModal.regeneratePdf', { defaultValue: '重新生成 PDF' })
          : t('shareModal.generatePdf', { defaultValue: '生成 PDF' })}
    </Button>
  );

  const downloadButton = pdfData ? (
    <Button
      block
      icon={DownloadIcon}
      onClick={handleDownload}
      size={isMobile ? undefined : 'large'}
      type="default"
    >
      {t('shareModal.downloadPdf')}
    </Button>
  ) : null;

  if (error) {
    return (
      <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
        <div className={containerStyles.preview} style={{ padding: 12 }}>
          <div style={{ color: 'red', textAlign: 'center' }}>
            {t('shareModal.pdfGenerationError')}: {error}
          </div>
        </div>
        <Flexbox className={styles.sidebar} gap={12}>
          <div>{t('shareModal.pdfErrorDescription')}</div>
          {generateButton}
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
      <PdfPreview loading={loading} onGeneratePdf={handleGeneratePdf} pdfData={pdfData} />
      {pdfData && (
        <Flexbox className={styles.sidebar} gap={12}>
          {pdfData && generateButton}
          {downloadButton}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default SharePdf;
