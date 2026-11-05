import { type UIChatMessage } from '@lobechat/types';
import { Button, Center, createStaticStyles, Flexbox, Text, toast } from '@lobehub/ui';
import { DownloadIcon, RotateCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ExportLayout from '../components/ExportLayout';
import TextOptions from '../ShareText/TextOptions';
import { type FieldType } from '../ShareText/type';
import PdfPreview from './PdfPreview';
import { useSharePdfExport } from './useSharePdfExport';

const DEFAULT_FIELD_VALUE: FieldType = {
  includeTool: true,
  includeUser: true,
  withRole: true,
  withSystemRole: false,
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  updating: css`
    pointer-events: none;

    position: absolute;
    z-index: 10;
    inset-block-start: 60px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: flex;
    gap: 8px;
    align-items: center;

    height: 32px;
    padding-inline: 12px;
    border-radius: 16px;

    font-size: 12px;
    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorText};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  updatingSpinner: css`
    width: 10px;
    height: 10px;
    border: 2px solid color-mix(in srgb, ${cssVar.colorBgContainer} 35%, transparent);
    border-block-start-color: ${cssVar.colorBgContainer};
    border-radius: 50%;

    animation: share-pdf-spin 800ms linear infinite;

    @keyframes share-pdf-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

const SharePdf = memo<{ message?: UIChatMessage }>(({ message }) => {
  const [fieldValue, setFieldValue] = useState(DEFAULT_FIELD_VALUE);
  const { t } = useTranslation(['chat', 'common']);

  const { downloadPdf, error, isEmpty, loading, messageCount, pdfData, regenerate } =
    useSharePdfExport(fieldValue, message);

  const handleDownload = async () => {
    try {
      await downloadPdf();
      toast.success(t('shareModal.downloadSuccess'));
    } catch {
      toast.error(t('shareModal.downloadError'));
    }
  };

  const showError = error && !loading;

  return (
    <ExportLayout
      meta={[t('shareModal.meta.messages', { count: messageCount }), '.pdf'].join(' · ')}
      toolbar={<TextOptions value={fieldValue} onChange={setFieldValue} />}
      actions={
        <Button
          disabled={!pdfData || loading || !!error}
          icon={DownloadIcon}
          type={'primary'}
          onClick={handleDownload}
        >
          {t('shareModal.actions.download')}
        </Button>
      }
      overlay={
        loading &&
        pdfData && (
          <div aria-live={'polite'} className={styles.updating} role={'status'}>
            <span className={styles.updatingSpinner} />
            {t('shareModal.pdfUpdating')}
          </div>
        )
      }
    >
      {isEmpty ? (
        <Center height={'100%'} paddingBlock={48}>
          <Text type={'secondary'}>{t('shareModal.noPdfData')}</Text>
        </Center>
      ) : showError ? (
        <Center height={'100%'} paddingBlock={48}>
          <Flexbox align={'center'} gap={12} style={{ maxWidth: 360, textAlign: 'center' }}>
            <Text strong>{t('shareModal.pdfGenerationError')}</Text>
            <Text type={'secondary'}>{t('shareModal.pdfErrorDescription')}</Text>
            <Button icon={RotateCwIcon} onClick={regenerate}>
              {t('retry', { ns: 'common' })}
            </Button>
          </Flexbox>
        </Center>
      ) : (
        <PdfPreview pdfData={pdfData} />
      )}
    </ExportLayout>
  );
});

export default SharePdf;
