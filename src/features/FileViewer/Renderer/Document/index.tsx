'use client';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Center, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import Loading from '@/components/Loading/CircleLoading';
import { Document, Page, pdfjs } from '@/libs/pdfjs';
import { localFileService } from '@/services/electron/localFileService';

import DocxPane from './DocxPane';
import OfficeOnlinePane from './OfficeOnlinePane';
import PptxPane from './PptxPane';
import XlsxPane from './xlsx/XlsxPane';

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

/**
 * Modern OOXML formats with an in-app renderer. Legacy binary formats (.doc /
 * .ppt / .xls) have none and keep the download / open-externally fallback.
 */
const OFFICE_PANES: Record<string, typeof DocxPane> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': PptxPane,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': XlsxPane,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DocxPane,
};

export interface DocumentPreviewProps {
  blob: Blob;
  contentType: string;
  filePath: string;
  /** File lives on this desktop's filesystem — offer "open with default app". */
  isLocalFile: boolean;
  /** Publicly fetchable URL, if the file has one — enables the online fallback. */
  sourceUrl?: string | null;
}

/**
 * Preview for binary documents transported as blobs — local workspace files in
 * the portal, and uploaded files fetched from their URL by the file viewer. PDFs render
 * inline via react-pdf (the Electron iframe PDF plugin is disabled, so a blob
 * URL in an iframe would not render on desktop); pptx / docx / xlsx render
 * inline via dynamically-imported client renderers, falling back to a
 * download / open-externally state when parsing fails. Legacy binary office
 * formats (.doc / .ppt / .xls / .odt) have no renderer; with a remote
 * `sourceUrl` they degrade to the online viewer, otherwise to download.
 */
const DocumentPreview = memo<DocumentPreviewProps>(
  ({ blob, contentType, filePath, isLocalFile, sourceUrl }) => {
    const { t } = useTranslation('chat');
    const filename = filePath.split('/').at(-1) ?? '';
    const [renderError, setRenderError] = useState(false);

    useEffect(() => {
      setRenderError(false);
    }, [blob, contentType]);

    const handleRenderError = useCallback((error: unknown) => {
      console.error('[DocumentPreview] office render failed:', error);
      setRenderError(true);
    }, []);

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

    const OfficePane = OFFICE_PANES[contentType];
    if (OfficePane && !renderError) {
      return <OfficePane blob={blob} onError={handleRenderError} />;
    }

    if (sourceUrl) return <OfficeOnlinePane url={sourceUrl} />;

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
