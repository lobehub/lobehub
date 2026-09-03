'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Bold, Download, Plus, Redo2, Save, Undo2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { loadXlsxDraft, saveXlsxDraft } from './draftStorage';
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

interface SheetView {
  name: string;
  rows: Array<Array<{ formula?: string; text: string }>>;
}

const columnName = (index: number) => {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
};

const readViews = async (bytes: ArrayBuffer): Promise<SheetView[]> => {
  const workbook = await loadXlsx(bytes);
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rows: Array.from({ length: Math.max(30, sheet.actualRowCount) }, (_, rowIndex) =>
      Array.from({ length: Math.max(12, sheet.actualColumnCount) }, (_, columnIndex) => {
        const cell = sheet.getCell(rowIndex + 1, columnIndex + 1);
        const value = cell.value;
        return {
          formula:
            value && typeof value === 'object' && 'formula' in value
              ? `=${value.formula}`
              : undefined,
          text: cell.text,
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
  const [selected, setSelected] = useState('A1');
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
  const selectedCell = useMemo(() => {
    const match = selected.match(/^([A-Z]+)(\d+)$/u);
    if (!match || !view) return undefined;
    const column = [...match[1]].reduce((sum, value) => sum * 26 + value.charCodeAt(0) - 64, 0) - 1;
    return view.rows[Number(match[2]) - 1]?.[column];
  }, [selected, view]);

  useEffect(() => setInput(selectedCell?.formula || selectedCell?.text || ''), [selectedCell]);

  const undo = useCallback(async () => {
    if (!bytes) return;
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(bytes);
    await refresh(previous);
  }, [bytes, refresh]);

  const redo = useCallback(async () => {
    if (!bytes) return;
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(bytes);
    await refresh(next);
  }, [bytes, refresh]);

  if (!bytes || !views || !view) return <NeuralNetworkLoading size={36} />;

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
            apply({ range: selected, sheet: view.name, style: { bold: true }, type: 'setStyle' })
          }
        />
        <span>{selected}</span>
        <input
          className={styles.formula}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter')
              void apply({
                range: selected,
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
                  {columnName(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className={`${styles.header} ${styles.rowHeader}`}>{rowIndex + 1}</th>
                {row.map((cell, columnIndex) => {
                  const address = `${columnName(columnIndex)}${rowIndex + 1}`;
                  return (
                    <td
                      className={`${styles.cell} ${selected === address ? styles.cellSelected : ''}`}
                      key={address}
                      onClick={() => setSelected(address)}
                      onDoubleClick={() => setInput(cell.formula || cell.text)}
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
      </Flexbox>
    </Flexbox>
  );
});

XLSXEditor.displayName = 'XLSXEditor';

export default XLSXEditor;
