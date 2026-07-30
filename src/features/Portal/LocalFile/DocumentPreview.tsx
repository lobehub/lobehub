'use client';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Center, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import Loading from '@/components/Loading/CircleLoading';
import { Document, Page, pdfjs } from '@/libs/pdfjs';
import { localFileService } from '@/services/electron/localFileService';

// Same CDN assets as the FileViewer PDF renderer — cmaps / fonts are required
// for non-latin PDFs.
const pdfOptions = {
  cMapUrl: `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/cmaps/`,
  standardFontDataUrl: `https://registry.npmmirror.com/pdfjs-dist/${pdfjs.version}/files/standard_fonts/`,
};

const maxPageWidth = 1200;

const styles = createStaticStyles(({ css }) => ({
  fallbackIcon: css`
    width: 64px;
    height: 64px;
    border-radius: 14px;
    background: ${cssVar.colorFillTertiary};
  `,
  page: css`
    overflow: hidden;
    margin-block-end: 12px;
    border-radius: 4px;
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  pdfContainer: css`
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;

    height: 100%;
    padding-block: 10px;

    background: ${cssVar.colorBgLayout};
  `,
}));

const PdfPane = memo<{ blob: Blob }>(({ blob }) => {
  const [numPages, setNumPages] = useState(0);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>();

  useEffect(() => {
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [container]);

  const width = containerWidth ? Math.min(containerWidth - 32, maxPageWidth) : undefined;

  return (
    <div className={styles.pdfContainer} ref={setContainer}>
      <Document
        file={blob}
        loading={<Loading />}
        options={pdfOptions}
        onLoadSuccess={(document) => setNumPages(document.numPages)}
      >
        {Array.from({ length: numPages }, (_, index) => (
          <Page
            className={styles.page}
            key={`page_${index + 1}`}
            pageNumber={index + 1}
            width={width}
          />
        ))}
      </Document>
    </div>
  );
});

PdfPane.displayName = 'PdfPane';

export interface DocumentPreviewProps {
  blob: Blob;
  contentType: string;
  filePath: string;
  /** File lives on this desktop's filesystem — offer "open with default app". */
  isLocalFile: boolean;
}

/**
 * In-portal preview for binary documents transported as blobs. PDFs render
 * inline via react-pdf (the Electron iframe PDF plugin is disabled, so a blob
 * URL in an iframe would not render on desktop); office formats have no local
 * renderer yet and degrade to a download / open-externally state.
 */
const DocumentPreview = memo<DocumentPreviewProps>(
  ({ blob, contentType, filePath, isLocalFile }) => {
    const { t } = useTranslation('chat');
    const filename = filePath.split('/').at(-1) ?? '';

    const handleDownload = useCallback(() => {
      const url = URL.createObjectURL(blob);
      const anchor = globalThis.document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      // Chromium resolves the blob URL synchronously on click, but defer the
      // revoke so slower engines can still start the download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, [blob, filename]);

    if (contentType === 'application/pdf') return <PdfPane blob={blob} />;

    return (
      <Center gap={16} height={'100%'} width={'100%'}>
        <Center className={styles.fallbackIcon}>
          <FileIcon fileName={filename} size={40} />
        </Center>
        <Flexbox align={'center'} gap={4}>
          <Text style={{ fontWeight: 500 }}>{filename}</Text>
          <Text type={'secondary'}>{t('workingPanel.localFile.document.unsupported')}</Text>
        </Flexbox>
        {isLocalFile ? (
          <Button onClick={() => localFileService.openLocalFile({ path: filePath })}>
            {t('workingPanel.localFile.document.openWithDefaultApp')}
          </Button>
        ) : (
          <Button onClick={handleDownload}>{t('workingPanel.localFile.document.download')}</Button>
        )}
      </Center>
    );
  },
);

DocumentPreview.displayName = 'DocumentPreview';

export default DocumentPreview;
