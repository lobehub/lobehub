'use client';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { Center, Flexbox } from '@lobehub/ui';
import { Button, Text, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import type { Workbook as ExcelWorkbook } from 'exceljs';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import Loading from '@/components/Loading/CircleLoading';
import { Document, Page, pdfjs } from '@/libs/pdfjs';
import { localFileService } from '@/services/electron/localFileService';

import {
  applyCellFormat,
  displayCell,
  EXCEL_MIME_TYPE,
  formulaInput,
  moveWorksheet,
  recalculateWorkbook,
  setCellInput,
  spliceWorksheetColumns,
  spliceWorksheetRows,
} from './excelWorkbook';

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
  sheetTabAdd: css`
    min-width: 28px;
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
  xlsxFormulaBar: css`
    display: grid;
    grid-template-columns: 64px minmax(160px, 1fr);
    gap: 6px;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    input {
      min-width: 0;
      padding-block: 4px;
      padding-inline: 8px;
      border: 1px solid ${cssVar.colorBorder};
      border-radius: 4px;

      color: ${cssVar.colorText};

      background: ${cssVar.colorBgContainer};
      outline: none;
    }
  `,
  xlsxTable: css`
    overflow: auto;
    flex: 1;

    table {
      border-collapse: collapse;
      font-size: 12px;
    }

    td,
    th {
      overflow: hidden;

      max-width: 320px;
      padding-block: 4px;
      padding-inline: 8px;
      border: 1px solid ${cssVar.colorBorderSecondary};

      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      color: ${cssVar.colorTextSecondary};
      text-align: center;

      background: ${cssVar.colorFillQuaternary};
    }

    th:first-child {
      z-index: 2;
      inset-inline-start: 0;
    }

    td:first-child {
      position: sticky;
      inset-inline-start: 0;

      color: ${cssVar.colorTextSecondary};
      text-align: center;

      background: ${cssVar.colorFillQuaternary};
    }

    td[data-selected='true'] {
      padding-block: 3px;
      padding-inline: 7px;
      border: 2px solid ${cssVar.colorPrimary};
    }

    td input {
      width: 100%;
      min-width: 72px;
      padding: 0;
      border: none;

      color: inherit;

      background: transparent;
      outline: none;
    }
  `,
  xlsxToolbar: css`
    overflow-x: auto;
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    white-space: nowrap;
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

const MAX_EDITOR_ROWS = 500;
const MIN_EDITOR_ROWS = 20;
const MIN_EDITOR_COLUMNS = 10;

const columnName = (index: number) => {
  let name = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
};

const XlsxPane = memo<OfficePaneProps>(({ blob, onError }) => {
  const { t } = useTranslation('chat');
  const workbookRef = useRef<ExcelWorkbook | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [activeSheet, setActiveSheet] = useState(0);
  const [selectedAddress, setSelectedAddress] = useState('A1');
  const [formula, setFormula] = useState('');
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const { Workbook } = await import('exceljs');
        const workbook = new Workbook();
        await workbook.xlsx.load(await blob.arrayBuffer());
        if (disposed) return;
        workbookRef.current = workbook;
        recalculateWorkbook(workbook);
        setActiveSheet(0);
        setSelectedAddress('A1');
        const firstSheet = workbook.worksheets[0];
        setFormula(firstSheet ? formulaInput(firstSheet.getCell('A1')) : '');
        setDirty(false);
        setReady(true);
      } catch (error) {
        if (!disposed) onError(error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [blob, onError]);

  if (!ready || !workbookRef.current) return <Loading />;

  const workbook = workbookRef.current;
  const sheet = workbook.worksheets[activeSheet] ?? workbook.worksheets[0];
  if (!sheet) return null;
  const rowCount = Math.min(MAX_EDITOR_ROWS, Math.max(MIN_EDITOR_ROWS, sheet.actualRowCount));
  const columnCount = Math.max(MIN_EDITOR_COLUMNS, sheet.actualColumnCount);
  const refresh = () => {
    setDirty(true);
    setVersion((value) => value + 1);
  };
  const selectCell = (address: string) => {
    setSelectedAddress(address);
    setFormula(formulaInput(sheet.getCell(address)));
  };
  const commit = (address: string, value: string) => {
    try {
      setCellInput(workbook, sheet, address, value);
      setFormula(formulaInput(sheet.getCell(address)));
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const selected = sheet.getCell(selectedAddress);
  const mutateStructure = (kind: 'column' | 'row', remove = false) => {
    if (kind === 'row') spliceWorksheetRows(workbook, sheet, Number(selected.row), remove ? 1 : 0);
    else spliceWorksheetColumns(workbook, sheet, Number(selected.col), remove ? 1 : 0);
    refresh();
  };
  const download = async () => {
    setSaving(true);
    try {
      recalculateWorkbook(workbook);
      const bytes = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: EXCEL_MIME_TYPE }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'workbook.xlsx';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDirty(false);
      toast.success(t('workingPanel.localFile.document.excel.exported'));
    } catch (error) {
      toast.error(t('workingPanel.localFile.document.excel.exportFailed'));
      console.error('[DocumentPreview] Excel export failed:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.xlsxContainer}>
      <div className={styles.xlsxToolbar}>
        <Button disabled={!dirty || saving} size={'small'} onClick={download}>
          {saving
            ? t('workingPanel.localFile.document.excel.saving')
            : t('workingPanel.localFile.document.excel.saveDownload')}
        </Button>
        <Button size={'small'} onClick={() => mutateStructure('row')}>
          {t('workingPanel.localFile.document.excel.insertRow')}
        </Button>
        <Button size={'small'} onClick={() => mutateStructure('row', true)}>
          {t('workingPanel.localFile.document.excel.deleteRow')}
        </Button>
        <Button size={'small'} onClick={() => mutateStructure('column')}>
          {t('workingPanel.localFile.document.excel.insertColumn')}
        </Button>
        <Button size={'small'} onClick={() => mutateStructure('column', true)}>
          {t('workingPanel.localFile.document.excel.deleteColumn')}
        </Button>
        <Button
          size={'small'}
          onClick={() => {
            applyCellFormat(selected, { bold: !selected.font?.bold });
            refresh();
          }}
        >
          B
        </Button>
        <Button
          size={'small'}
          onClick={() => {
            applyCellFormat(selected, { italic: !selected.font?.italic });
            refresh();
          }}
        >
          I
        </Button>
        {(['left', 'center', 'right'] as const).map((align) => (
          <Button
            key={align}
            size={'small'}
            onClick={() => {
              applyCellFormat(selected, { align });
              refresh();
            }}
          >
            {t(`workingPanel.localFile.document.excel.align.${align}`)}
          </Button>
        ))}
        {(['0.00', '$#,##0.00', '0.0%'] as const).map((numberFormat) => (
          <Button
            key={numberFormat}
            size={'small'}
            onClick={() => {
              applyCellFormat(selected, { numberFormat });
              refresh();
            }}
          >
            {numberFormat}
          </Button>
        ))}
        <input
          aria-label={t('workingPanel.localFile.document.excel.fillColor')}
          type={'color'}
          onChange={(event) => {
            applyCellFormat(selected, { fill: event.target.value });
            refresh();
          }}
        />
      </div>
      <div className={styles.xlsxFormulaBar}>
        <input
          readOnly
          aria-label={t('workingPanel.localFile.document.excel.cellAddress')}
          value={selectedAddress}
        />
        <input
          aria-label={t('workingPanel.localFile.document.excel.formula')}
          value={formula}
          onBlur={() => commit(selectedAddress, formula)}
          onChange={(event) => setFormula(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      <div className={styles.xlsxTable}>
        <table key={version}>
          <thead>
            <tr>
              <th />
              {Array.from({ length: columnCount }, (_, index) => (
                <th key={index}>{columnName(index + 1)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, rowIndex) => (
              <tr key={rowIndex + 1}>
                <td>{rowIndex + 1}</td>
                {Array.from({ length: columnCount }, (_, columnIndex) => {
                  const address = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
                  const cell = sheet.getCell(address);
                  return (
                    <td
                      data-selected={address === selectedAddress}
                      key={address}
                      style={{
                        background:
                          cell.fill?.type === 'pattern'
                            ? `#${cell.fill.fgColor?.argb?.slice(-6)}`
                            : undefined,
                        fontStyle: cell.font?.italic ? 'italic' : undefined,
                        fontWeight: cell.font?.bold ? 600 : undefined,
                        textAlign: cell.alignment?.horizontal as
                          'center' | 'left' | 'right' | undefined,
                      }}
                      onClick={() => selectCell(address)}
                      onPaste={(event) => {
                        event.preventDefault();
                        const rows = event.clipboardData
                          .getData('text')
                          .replaceAll('\r', '')
                          .split('\n');
                        rows.forEach((line, pasteRow) =>
                          line.split('\t').forEach((value, pasteColumn) => {
                            const target = sheet.getCell(
                              rowIndex + pasteRow + 1,
                              columnIndex + pasteColumn + 1,
                            );
                            setCellInput(workbook, sheet, target.address, value);
                          }),
                        );
                        refresh();
                      }}
                    >
                      <input
                        aria-label={address}
                        defaultValue={displayCell(cell)}
                        onBlur={(event) => commit(address, event.target.value)}
                        onFocus={() => selectCell(address)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {sheet.actualRowCount > MAX_EDITOR_ROWS && (
          <div className={styles.truncatedNote}>
            {t('workingPanel.localFile.document.truncatedRows', { count: MAX_EDITOR_ROWS })}
          </div>
        )}
      </div>
      <div className={styles.sheetTabs}>
        {workbook.worksheets.map((item, index) => (
          <button
            className={styles.sheetTab}
            data-active={index === activeSheet}
            key={item.id}
            type={'button'}
            onClick={() => {
              setActiveSheet(index);
              setSelectedAddress('A1');
              setFormula(formulaInput(item.getCell('A1')));
            }}
            onDoubleClick={() => {
              const name = globalThis
                .prompt(t('workingPanel.localFile.document.excel.renameSheet'), item.name)
                ?.trim();
              if (name) {
                item.name = name;
                refresh();
              }
            }}
          >
            {item.name}
          </button>
        ))}
        <Button
          className={styles.sheetTabAdd}
          size={'small'}
          title={t('workingPanel.localFile.document.excel.addSheet')}
          onClick={() => {
            const item = workbook.addWorksheet();
            setActiveSheet(workbook.worksheets.indexOf(item));
            refresh();
          }}
        >
          +
        </Button>
        <Button
          disabled={activeSheet === 0}
          size={'small'}
          onClick={() => {
            moveWorksheet(workbook, activeSheet, activeSheet - 1);
            setActiveSheet(activeSheet - 1);
            refresh();
          }}
        >
          ←
        </Button>
        <Button
          disabled={activeSheet === workbook.worksheets.length - 1}
          size={'small'}
          onClick={() => {
            moveWorksheet(workbook, activeSheet, activeSheet + 1);
            setActiveSheet(activeSheet + 1);
            refresh();
          }}
        >
          →
        </Button>
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
