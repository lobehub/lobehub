import { type UIChatMessage } from '@lobechat/types';
import { Button, Center, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const spin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  updating: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '60px',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    height: '32px',
    paddingInline: '12px',
    borderRadius: '16px',
    fontSize: '12px',
    color: cssVar.colorBgContainer,
    backgroundColor: cssVar.colorText,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  updatingSpinner: {
    width: '10px',
    height: '10px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 35%, transparent)`,
    borderBlockStartColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    animationName: { 'default': spin, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: '800ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});

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
          <div aria-live={'polite'} {...stylex.props(styles.updating)} role={'status'}>
            <span {...stylex.props(styles.updatingSpinner)} />
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
