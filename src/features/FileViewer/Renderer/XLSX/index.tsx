'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eraser,
  Italic,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { loadXlsxDraft, saveXlsxDraft } from './draftStorage';
import {
  columnName,
  formatCellNumber,
  isInBounds,
  parseCellAddress,
  rangeAddress,
  rangeAnchoredAt,
  rangeBetween,
  rangeSize,
} from './gridUtils';
import { editXlsx, loadXlsx, XLSX_MIME_TYPE } from './xlsxOperations';

const styles = createStaticStyles(({ css }) => ({
  cell: css`
    overflow: hidden;

    min-width: 96px;
    max-width: 240px;
    height: 28px;
    padding-block: 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    white-space: nowrap;
  `,
  cellInRange: css`
    background: ${cssVar.colorPrimaryBg};
  `,
  cellSelected: css`
    outline: 2px solid ${cssVar.colorPrimary};
    outline-offset: -2px;
  `,
  editor: css`
    min-width: 0;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  formula: css`
    flex: 1;

    min-width: 160px;
    height: 30px;
    padding-inline: 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  grid: css`
    overflow: auto;
    flex: 1;
    min-height: 0;

    table {
      table-layout: fixed;
      border-spacing: 0;
    }
  `,
  header: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    min-width: 96px;
    height: 28px;
    border-block-end: 1px solid ${cssVar.colorBorder};
    border-inline-end: 1px solid ${cssVar.colorBorder};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  rowHeader: css`
    position: sticky;
    inset-inline-start: 0;
    min-width: 44px;
  `,
  sheetTab: css`
    padding-block: 6px;
    padding-inline: 12px;
    border: 0;
    border-block-start: 2px solid transparent;

    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &[data-active='true'] {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
    }
  `,
  sheets: css`
    overflow-x: auto;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgLayout};
  `,
  status: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  toolbar: css`
    flex-wrap: wrap;

    min-height: 48px;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface XLSXEditorProps {
  fileId: string;
  fileName: string;
  url: string;
}

interface CellView {
  formula?: string;
  numeric?: number;
  style?: CSSProperties;
  text: string;
}

interface SheetView {
  name: string;
  rows: CellView[][];
}

const NUMBER_FORMATS = [
  { key: 'general', value: 'General' },
  { key: 'number', value: '#,##0.00' },
  { key: 'currency', value: '$#,##0.00' },
  { key: 'percent', value: '0.00%' },
] as const;

const readViews = async (bytes: ArrayBuffer): Promise<SheetView[]> => {
  const workbook = await loadXlsx(bytes);
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rows: Array.from({ length: Math.max(30, sheet.actualRowCount) }, (_, rowIndex) =>
      Array.from({ length: Math.max(12, sheet.actualColumnCount) }, (_, columnIndex) => {
        const cell = sheet.getCell(rowIndex + 1, columnIndex + 1);
        const value = cell.value;
        const rawNumeric =
          typeof value === 'number'
            ? value
            : value && typeof value === 'object' && 'result' in value
              ? Number(value.result)
              : undefined;
        const numeric =
          rawNumeric !== undefined && Number.isFinite(rawNumeric) ? rawNumeric : undefined;
        const fill =
          cell.fill?.type === 'pattern' && cell.fill.fgColor?.argb
            ? `#${cell.fill.fgColor.argb.slice(-6)}`
            : undefined;
        return {
          formula:
            value && typeof value === 'object' && 'formula' in value
              ? `=${value.formula}`
              : undefined,
          numeric,
          style: {
            background: fill,
            fontStyle: cell.font?.italic ? 'italic' : undefined,
            fontWeight: cell.font?.bold ? 600 : undefined,
            textAlign: cell.alignment?.horizontal as CSSProperties['textAlign'],
          },
          text: (numeric !== undefined && formatCellNumber(numeric, cell.numFmt)) || cell.text,
        };
      }),
    ),
  }));
};

const download = (bytes: ArrayBuffer, fileName: string) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME_TYPE }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const XLSXEditor = memo<XLSXEditorProps>(({ fileId, fileName, url }) => {
  const { t } = useTranslation('file');
  const undoRef = useRef<ArrayBuffer[]>([]);
  const redoRef = useRef<ArrayBuffer[]>([]);
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [views, setViews] = useState<SheetView[]>();
  const [activeSheet, setActiveSheet] = useState(0);
  const [anchor, setAnchor] = useState('A1');
  const [focus, setFocus] = useState('A1');
  const [clipboard, setClipboard] = useState<{ range: string; sheet: string }>();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'xlsxEditor.status.saved' | 'xlsxEditor.status.unsaved'>(
    'xlsxEditor.status.saved',
  );

  const refresh = useCallback(async (nextBytes: ArrayBuffer) => {
    setBytes(nextBytes);
    setViews(await readViews(nextBytes));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const draft = await loadXlsxDraft(fileId, url);
      const source = draft ?? (await fetch(url).then((response) => response.arrayBuffer()));
      if (!source) throw new Error('XLSX source is empty');
      if (active) await refresh(source);
    })().catch((error) => console.error('[XLSXEditor] load failed:', error));
    return () => {
      active = false;
    };
  }, [fileId, refresh, url]);

  const apply = useCallback(
    async (operation: Parameters<typeof editXlsx>[1]) => {
      if (!bytes) return;
      undoRef.current.push(bytes);
      redoRef.current = [];
      const next = await editXlsx(bytes, operation);
      await refresh(next);
      await saveXlsxDraft(fileId, url, next);
      setStatus('xlsxEditor.status.unsaved');
    },
    [bytes, fileId, refresh, url],
  );

  const view = views?.[activeSheet];
  const selection = useMemo(() => rangeBetween(anchor, focus), [anchor, focus]);
  const selectedRange = rangeAddress(selection);
  const anchorCell = useMemo(() => {
    if (!view) return undefined;
    const { column, row } = parseCellAddress(anchor);
    return view.rows[row - 1]?.[column - 1];
  }, [anchor, view]);

  useEffect(() => setInput(anchorCell?.formula || anchorCell?.text || ''), [anchorCell]);

  // Structural edits can leave the selection or active tab out of bounds.
  useEffect(() => {
    if (views && activeSheet >= views.length) setActiveSheet(views.length - 1);
  }, [activeSheet, views]);

  const restore = useCallback(
    async (previous: ArrayBuffer) => {
      await refresh(previous);
      await saveXlsxDraft(fileId, url, previous);
      setStatus('xlsxEditor.status.unsaved');
    },
    [fileId, refresh, url],
  );

  const undo = useCallback(async () => {
    if (!bytes) return;
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(bytes);
    await restore(previous);
  }, [bytes, restore]);

  const redo = useCallback(async () => {
    if (!bytes) return;
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(bytes);
    await restore(next);
  }, [bytes, restore]);

  const paste = useCallback(() => {
    if (!clipboard || !view) return;
    const [from, to = from] = clipboard.range.split(':');
    const size = rangeSize(rangeBetween(from, to));
    void apply({
      from: clipboard.range,
      sheet: clipboard.sheet,
      to: rangeAnchoredAt(anchor, size),
      toSheet: view.name,
      type: 'copyRange',
    });
  }, [anchor, apply, clipboard, view]);

  if (!bytes || !views || !view) return <NeuralNetworkLoading size={36} />;

  const selectionRows = rangeSize(selection).rows;
  const selectionColumns = rangeSize(selection).columns;

  return (
    <Flexbox className={styles.editor}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={8}>
        <ActionIcon
          disabled={!undoRef.current.length}
          icon={Undo2}
          title={t('xlsxEditor.actions.undo')}
          onClick={undo}
        />
        <ActionIcon
          disabled={!redoRef.current.length}
          icon={Redo2}
          title={t('xlsxEditor.actions.redo')}
          onClick={redo}
        />
        <ActionIcon
          icon={Bold}
          title={t('xlsxEditor.actions.bold')}
          onClick={() =>
            apply({
              range: selectedRange,
              sheet: view.name,
              style: { bold: true },
              type: 'setStyle',
            })
          }
        />
        <ActionIcon
          icon={Italic}
          title={t('xlsxEditor.actions.italic')}
          onClick={() =>
            apply({
              range: selectedRange,
              sheet: view.name,
              style: { italic: true },
              type: 'setStyle',
            })
          }
        />
        <ActionIcon
          icon={AlignLeft}
          title={t('xlsxEditor.actions.alignLeft')}
          onClick={() =>
            apply({
              range: selectedRange,
              sheet: view.name,
              style: { horizontal: 'left' },
              type: 'setStyle',
            })
          }
        />
        <ActionIcon
          icon={AlignCenter}
          title={t('xlsxEditor.actions.alignCenter')}
          onClick={() =>
            apply({
              range: selectedRange,
              sheet: view.name,
              style: { horizontal: 'center' },
              type: 'setStyle',
            })
          }
        />
        <ActionIcon
          icon={AlignRight}
          title={t('xlsxEditor.actions.alignRight')}
          onClick={() =>
            apply({
              range: selectedRange,
              sheet: view.name,
              style: { horizontal: 'right' },
              type: 'setStyle',
            })
          }
        />
        <Select
          placeholder={t('xlsxEditor.actions.numberFormat')}
          size={'small'}
          style={{ width: 120 }}
          value={null}
          options={NUMBER_FORMATS.map((format) => ({
            label: t(`xlsxEditor.formats.${format.key}`),
            value: format.value,
          }))}
          onChange={(format) => {
            if (typeof format !== 'string') return;
            void apply({
              range: selectedRange,
              sheet: view.name,
              style: { numberFormat: format },
              type: 'setStyle',
            });
          }}
        />
        <ActionIcon
          icon={Copy}
          title={t('xlsxEditor.actions.copy')}
          onClick={() => setClipboard({ range: selectedRange, sheet: view.name })}
        />
        <ActionIcon
          disabled={!clipboard}
          icon={ClipboardPaste}
          title={t('xlsxEditor.actions.paste')}
          onClick={paste}
        />
        <ActionIcon
          icon={Eraser}
          title={t('xlsxEditor.actions.clear')}
          onClick={() => apply({ range: selectedRange, sheet: view.name, type: 'clearRange' })}
        />
        <Button
          size={'small'}
          onClick={() =>
            apply({
              at: selection.start.row,
              count: selectionRows,
              sheet: view.name,
              type: 'insertRows',
            })
          }
        >
          {t('xlsxEditor.actions.insertRow')}
        </Button>
        <Button
          size={'small'}
          onClick={() =>
            apply({
              at: selection.start.row,
              count: selectionRows,
              sheet: view.name,
              type: 'deleteRows',
            })
          }
        >
          {t('xlsxEditor.actions.deleteRow')}
        </Button>
        <Button
          size={'small'}
          onClick={() =>
            apply({
              at: selection.start.column,
              count: selectionColumns,
              sheet: view.name,
              type: 'insertColumns',
            })
          }
        >
          {t('xlsxEditor.actions.insertColumn')}
        </Button>
        <Button
          size={'small'}
          onClick={() =>
            apply({
              at: selection.start.column,
              count: selectionColumns,
              sheet: view.name,
              type: 'deleteColumns',
            })
          }
        >
          {t('xlsxEditor.actions.deleteColumn')}
        </Button>
        <span>{selectedRange}</span>
        <input
          className={styles.formula}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              void apply({
                range: anchor,
                sheet: view.name,
                type: 'setCells',
                values: [[input]],
              });
          }}
        />
        <Button
          icon={Save}
          size={'small'}
          onClick={() => {
            void saveXlsxDraft(fileId, url, bytes);
            setStatus('xlsxEditor.status.saved');
          }}
        >
          {t('xlsxEditor.actions.save')}
        </Button>
        <Button icon={Download} size={'small'} onClick={() => download(bytes, fileName)}>
          {t('xlsxEditor.actions.download')}
        </Button>
        <span className={styles.status}>{t(status)}</span>
      </Flexbox>
      <div className={styles.grid}>
        <table>
          <thead>
            <tr>
              <th className={`${styles.header} ${styles.rowHeader}`} />
              {view.rows[0].map((_, index) => (
                <th className={styles.header} key={index}>
                  {columnName(index + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className={`${styles.header} ${styles.rowHeader}`}>{rowIndex + 1}</th>
                {row.map((cell, columnIndex) => {
                  const address = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
                  const inRange =
                    selectedRange !== anchor &&
                    isInBounds(selection, rowIndex + 1, columnIndex + 1);
                  return (
                    <td
                      key={address}
                      style={cell.style}
                      className={[
                        styles.cell,
                        address === anchor ? styles.cellSelected : '',
                        inRange ? styles.cellInRange : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onDoubleClick={() => setInput(cell.formula || cell.text)}
                      onClick={(event) => {
                        if (event.shiftKey) setFocus(address);
                        else {
                          setAnchor(address);
                          setFocus(address);
                        }
                      }}
                    >
                      {cell.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Flexbox horizontal align={'center'} className={styles.sheets}>
        {views.map((sheet, index) => (
          <button
            className={styles.sheetTab}
            data-active={index === activeSheet}
            key={sheet.name}
            type={'button'}
            onClick={() => setActiveSheet(index)}
            onDoubleClick={() => {
              const name = prompt(t('xlsxEditor.prompts.renameSheet'), sheet.name);
              if (name) void apply({ name: sheet.name, newName: name, type: 'renameSheet' });
            }}
          >
            {sheet.name}
          </button>
        ))}
        <ActionIcon
          icon={Plus}
          title={t('xlsxEditor.actions.addSheet')}
          onClick={() => void apply({ name: `Sheet${views.length + 1}`, type: 'addSheet' })}
        />
        <ActionIcon
          disabled={activeSheet === 0}
          icon={ChevronLeft}
          title={t('xlsxEditor.actions.moveSheetLeft')}
          onClick={() => {
            void apply({ fromIndex: activeSheet, toIndex: activeSheet - 1, type: 'moveSheet' });
            setActiveSheet(activeSheet - 1);
          }}
        />
        <ActionIcon
          disabled={activeSheet === views.length - 1}
          icon={ChevronRight}
          title={t('xlsxEditor.actions.moveSheetRight')}
          onClick={() => {
            void apply({ fromIndex: activeSheet, toIndex: activeSheet + 1, type: 'moveSheet' });
            setActiveSheet(activeSheet + 1);
          }}
        />
        <ActionIcon
          disabled={views.length === 1}
          icon={Trash2}
          title={t('xlsxEditor.actions.deleteSheet')}
          onClick={() => {
            if (confirm(t('xlsxEditor.prompts.deleteSheet', { name: view.name })))
              void apply({ name: view.name, type: 'deleteSheet' });
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

XLSXEditor.displayName = 'XLSXEditor';

export default XLSXEditor;
