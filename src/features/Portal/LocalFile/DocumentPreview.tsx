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

    /* docx-preview renders fixed-size "pages"; keep them centered with a gap.
       "safe center" falls back to flex-start when the page is wider than the
       pane, so the left edge stays reachable by horizontal scroll. */
    .docx-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: safe center;

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
  sheetTab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 12px;
    border: none;
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &[data-active='true'] {
      font-weight: 500;
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  sheetTabs: css`
    overflow-x: auto;
    display: flex;
    flex: none;
    gap: 4px;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  truncatedNote: css`
    padding-block: 8px;
    padding-inline: 12px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  xlsxContainer: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  xlsxTable: css`
    overflow: auto;
    flex: 1;

    table {
      border-collapse: collapse;
      font-size: 12px;
    }

    td {
      overflow: hidden;

      max-width: 320px;
      padding-block: 4px;
      padding-inline: 8px;
      border: 1px solid ${cssVar.colorBorderSecondary};

      text-overflow: ellipsis;
      white-space: nowrap;
    }
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
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!container || !scrollEl) return;

    const controller = new AbortController();
    let viewer: { destroy: () => void } | undefined;

    (async () => {
      try {
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
        if (controller.signal.aborted) return;
        viewer = await PptxViewer.open(blob, container, {
          listOptions: { windowed: true },
          scrollContainer: scrollEl,
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
  }, [blob, container, scrollEl, onError]);

  return (
    <div className={styles.officeContainer} ref={setScrollEl}>
      {loading && <Loading />}
      {/* The viewer owns this node's children — React must never render into it,
          or its bookkeeping breaks when the library replaces the content. */}
      <div ref={setContainer} />
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
 * DOM tables choke on huge sheets; a preview only needs the head of the data.
 * Users open the real file (default app / download) for the full sheet.
 */
const MAX_PREVIEW_ROWS = 500;

interface SheetGrid {
  name: string;
  rows: string[][];
  truncated: boolean;
}

/** Flatten an exceljs cell value (rich text / formula / hyperlink / date …) to display text. */
const formatCellValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as {
      error?: string;
      formula?: string;
      hyperlink?: string;
      result?: unknown;
      richText?: { text: string }[];
      text?: unknown;
    };
    if (cell.richText) return cell.richText.map((run) => run.text).join('');
    if (cell.formula !== undefined) return formatCellValue(cell.result);
    if (cell.text !== undefined) return formatCellValue(cell.text);
    if (cell.error) return cell.error;
    return '';
  }
  return String(value);
};

const XlsxPane = memo<OfficePaneProps>(({ blob, onError }) => {
  const { t } = useTranslation('chat');
  const [sheets, setSheets] = useState<SheetGrid[]>();
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const { Workbook } = await import('exceljs');
        const workbook = new Workbook();
        await workbook.xlsx.load(await blob.arrayBuffer());
        if (disposed) return;

        const grids: SheetGrid[] = workbook.worksheets.map((sheet) => {
          const columnCount = sheet.actualColumnCount;
          const rows: string[][] = [];
          // eachRow skips empty rows, keeping the preview dense; row order is preserved.
          sheet.eachRow((row) => {
            if (rows.length >= MAX_PREVIEW_ROWS) return;
            const cells: string[] = [];
            for (let index = 1; index <= columnCount; index++) {
              cells.push(formatCellValue(row.getCell(index).value));
            }
            rows.push(cells);
          });
          return { name: sheet.name, rows, truncated: sheet.actualRowCount > MAX_PREVIEW_ROWS };
        });
        setSheets(grids);
        setActiveSheet(0);
      } catch (error) {
        if (!disposed) onError(error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [blob, onError]);

  if (!sheets) return <Loading />;

  const sheet = sheets[activeSheet] ?? sheets[0];

  return (
    <div className={styles.xlsxContainer}>
      {sheets.length > 1 && (
        <div className={styles.sheetTabs}>
          {sheets.map((item, index) => (
            <button
              className={styles.sheetTab}
              data-active={index === activeSheet}
              key={`${index}-${item.name}`}
              type={'button'}
              onClick={() => setActiveSheet(index)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className={styles.xlsxTable}>
        <table>
          <tbody>
            {sheet?.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet?.truncated && (
          <div className={styles.truncatedNote}>
            {t('workingPanel.localFile.document.truncatedRows', { count: MAX_PREVIEW_ROWS })}
          </div>
        )}
      </div>
    </div>
  );
});

XlsxPane.displayName = 'XlsxPane';

/**
 * Modern OOXML formats with an in-app renderer. Legacy binary formats (.doc /
 * .ppt / .xls) have none and keep the download / open-externally fallback.
 */
const OFFICE_PANES: Record<string, typeof PptxPane> = {
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
}

/**
 * In-portal preview for binary documents transported as blobs. PDFs render
 * inline via react-pdf (the Electron iframe PDF plugin is disabled, so a blob
 * URL in an iframe would not render on desktop); pptx / docx / xlsx render
 * inline via dynamically-imported client renderers, falling back to a
 * download / open-externally state when parsing fails. Legacy binary office
 * formats (.doc / .ppt / .xls) have no local renderer and always degrade.
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
