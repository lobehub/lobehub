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
  docxContainer: css`
    overflow: auto;
    height: 100%;
    background: ${cssVar.colorBgLayout};

    /* docx-preview renders fixed-size "pages"; keep them centered with a gap. */
    .docx-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;

      padding: 10px;

      background: transparent;
    }

    .docx-wrapper > section.docx {
      margin-block-end: 0;
      border-radius: 4px;
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  fallbackIcon: css`
    width: 64px;
    height: 64px;
    border-radius: 14px;
    background: ${cssVar.colorFillTertiary};
  `,
  officeContainer: css`
    overflow: auto;
    height: 100%;
    background: ${cssVar.colorBgLayout};
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

interface OfficePaneProps {
  blob: Blob;
  /** Renderer failed — parent swaps in the download / open-externally state. */
  onError: (error: unknown) => void;
}

const PptxPane = memo<OfficePaneProps>(({ blob, onError }) => {
  const [loading, setLoading] = useState(true);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!container) return;

    const controller = new AbortController();
    let viewer: { destroy: () => void } | undefined;

    (async () => {
      try {
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
        if (controller.signal.aborted) return;
        viewer = await PptxViewer.open(blob, container, {
          listOptions: { windowed: true },
          scrollContainer: container,
          signal: controller.signal,
          // Local files are still untrusted input (agent/tool generated) — cap
          // the ZIP expansion to keep a hostile pptx from exhausting memory.
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });
        setLoading(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        onError(error);
      }
    })();

    return () => {
      controller.abort();
      viewer?.destroy();
    };
  }, [blob, container, onError]);

  return (
    <div className={styles.officeContainer} ref={setContainer}>
      {loading && <Loading />}
    </div>
  );
});

PptxPane.displayName = 'PptxPane';

const DocxPane = memo<OfficePaneProps>(({ blob, onError }) => {
  const [loading, setLoading] = useState(true);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!container) return;

    let disposed = false;

    (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        if (disposed) return;
        await renderAsync(blob, container);
        if (!disposed) setLoading(false);
      } catch (error) {
        if (!disposed) onError(error);
      }
    })();

    return () => {
      disposed = true;
      // renderAsync has no dispose handle — it owns the container's children
      // (including injected <style>), so clearing it is the documented cleanup.
      container.replaceChildren();
    };
  }, [blob, container, onError]);

  return (
    <div className={styles.docxContainer}>
      {loading && <Loading />}
      <div ref={setContainer} />
    </div>
  );
});

DocxPane.displayName = 'DocxPane';

/**
 * Modern OOXML formats with an in-app renderer. Legacy binary formats (.doc /
 * .ppt) and spreadsheets have none and keep the download / open-externally
 * fallback.
 */
const OFFICE_PANES: Record<string, typeof PptxPane> = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': PptxPane,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': DocxPane,
};

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
 * URL in an iframe would not render on desktop); pptx / docx render inline via
 * dynamically-imported client renderers, falling back to a download /
 * open-externally state when parsing fails. Legacy binary office formats
 * (.doc / .ppt) and spreadsheets have no local renderer and always degrade.
 */
const DocumentPreview = memo<DocumentPreviewProps>(
  ({ blob, contentType, filePath, isLocalFile }) => {
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
