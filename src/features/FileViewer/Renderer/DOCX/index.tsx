'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ClipboardPaste,
  Copy,
  Download,
  ImagePlus,
  Link,
  List,
  ListOrdered,
  Pencil,
  Plus,
  Redo2,
  Save,
  Table2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { type CSSProperties, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import OfficeSaveError from '../Office/OfficeSaveError';
import { useOfficeDocumentQueue } from '../Office/useOfficeDocumentQueue';
import { useOfficeEditorShortcuts } from '../Office/useOfficeEditorShortcuts';
import {
  DOCX_MIME_TYPE,
  type DocxBlock,
  type DocxEditOperation,
  editDocx,
  inspectDocx,
} from './docxOperations';
import { loadDocxDraft, saveDocxDraft } from './draftStorage';

const styles = createStaticStyles(({ css }) => ({
  block: css`
    width: min(816px, calc(100% - 48px));
    min-height: 34px;
    padding-block: 6px;
    padding-inline: 8px;
    border: 1px solid transparent;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorText};
    text-align: start;

    background: transparent;

    &:hover,
    &[data-selected='true'] {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorBgContainer};
    }
  `,
  canvas: css`
    overflow: auto;
    flex: 1;

    min-height: 0;
    padding: 24px;

    background: ${cssVar.colorBgLayout};
  `,
  editor: css`
    height: 100%;
    min-height: 0;
    background: ${cssVar.colorBgContainer};
  `,
  image: css`
    cursor: pointer;

    max-width: 100%;
    max-height: 320px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusSM};
  `,
  input: css`
    resize: vertical;

    width: 100%;
    min-height: 32px;
    border: 0;

    font: inherit;
    color: inherit;

    background: transparent;
    outline: 0;
  `,
  linkBadge: css`
    font-size: 12px;
    color: ${cssVar.colorLink};
  `,
  listMarker: css`
    flex: none;
    padding-block-start: 2px;
    color: ${cssVar.colorTextSecondary};
  `,
  status: css`
    margin-inline-start: auto;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  table: css`
    font-family: monospace;
    white-space: pre-line;
  `,
  toolbar: css`
    overflow-x: auto;
    flex: none;

    min-height: 48px;
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface DOCXEditorProps {
  fileId: string;
  fileName: string;
  url: string;
}

const download = (bytes: ArrayBuffer, fileName: string) => {
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: DOCX_MIME_TYPE }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName.toLowerCase().endsWith('.docx') ? fileName : `${fileName}.docx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
};

const FONT_FAMILIES = [
  'Arial',
  'Calibri',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Microsoft YaHei',
  'SimSun',
];
const FONT_SIZES = [10, 12, 14, 16, 18, 22, 28];
const HEADING_PREVIEW_SIZES: Record<string, number> = {
  Heading1: 24,
  Heading2: 20,
  Heading3: 17,
  Title: 28,
};

const previewStyle = (block: DocxBlock): CSSProperties => ({
  fontFamily: block.fontFamily,
  fontSize: block.fontSize
    ? Math.round(block.fontSize * 1.33)
    : block.style
      ? HEADING_PREVIEW_SIZES[block.style]
      : undefined,
  fontWeight: block.bold || (block.style && HEADING_PREVIEW_SIZES[block.style]) ? 600 : undefined,
  textAlign: block.alignment === 'justify' ? 'justify' : block.alignment,
});

type BlockSelection = { index: number; kind: 'paragraph' | 'table' };

const DOCXEditor = memo<DOCXEditorProps>(({ fileId, fileName, url }) => {
  const { t } = useTranslation('file');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageActionRef = useRef<{ index: number; type: 'replace' } | { type: 'insert' }>({
    type: 'insert',
  });
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [blocks, setBlocks] = useState<DocxBlock[]>();
  const [selected, setSelected] = useState<BlockSelection>({ index: 0, kind: 'paragraph' });
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');

  const refresh = useCallback(async (next: ArrayBuffer) => {
    setBytes(next);
    setBlocks(await inspectDocx(next));
  }, []);

  const onDocumentChange = useCallback(
    async (next: ArrayBuffer) => {
      setStatus('saving');
      await refresh(next);
      try {
        await saveDocxDraft(fileId, url, next);
        setStatus('unsaved');
        setError(undefined);
      } catch (cause) {
        setStatus('failed');
        throw cause;
      }
    },
    [fileId, refresh, url],
  );
  const onQueueError = useCallback((cause: unknown) => {
    setStatus('failed');
    setError(cause);
  }, []);
  const {
    apply: applyQueued,
    initialize,
    redo,
    redoStackRef,
    undo,
    undoStackRef,
    withCurrent,
  } = useOfficeDocumentQueue(onDocumentChange, onQueueError);

  const load = useCallback(async () => {
    setError(undefined);
    const draft = await loadDocxDraft(fileId, url);
    const source = draft || (await (await fetch(url)).arrayBuffer());
    initialize(source);
    await refresh(source);
    setStatus('saved');
  }, [fileId, initialize, refresh, url]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  const apply = useCallback(
    (operation: DocxEditOperation) => {
      setStatus('saving');
      return applyQueued((current) => editDocx(current, operation));
    },
    [applyQueued],
  );

  const save = useCallback(() => {
    setStatus('saving');
    void withCurrent(async (current) => {
      await saveDocxDraft(fileId, url, current);
      setStatus('saved');
      setError(undefined);
    }).catch(onQueueError);
  }, [fileId, onQueueError, url, withCurrent]);
  const downloadCurrent = useCallback(() => {
    void withCurrent((current) => download(current, fileName));
  }, [fileName, withCurrent]);

  useOfficeEditorShortcuts({
    dirty: status !== 'saved',
    onRedo: () => void redo(),
    onSave: save,
    onUndo: () => void undo(),
  });

  const selectedParagraph = blocks?.find(
    (block) =>
      block.kind === 'paragraph' && selected.kind === 'paragraph' && block.index === selected.index,
  );
  const selectedBlock = blocks?.find(
    (block) => block.kind === selected.kind && block.index === selected.index,
  );
  const lastParagraphIndex =
    (blocks?.filter((block) => block.kind === 'paragraph').length ?? 1) - 1;

  const pasteParagraph = useCallback(async () => {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    await apply({
      afterIndex: selectedParagraph?.index ?? lastParagraphIndex,
      text,
      type: 'insertParagraph',
    });
  }, [apply, lastParagraphIndex, selectedParagraph]);

  const deleteSelected = useCallback(() => {
    if (!selectedBlock) return;
    void apply({ index: selectedBlock.index, kind: selectedBlock.kind, type: 'deleteBlock' });
    setSelected({ index: 0, kind: 'paragraph' });
  }, [apply, selectedBlock]);

  const toggleList = useCallback(
    (kind: 'bullet' | 'number') => {
      if (!selectedParagraph) return;
      void apply({
        index: selectedParagraph.index,
        list: selectedParagraph.list === kind ? null : kind,
        type: 'setParagraphList',
      });
    },
    [apply, selectedParagraph],
  );

  const editTableCells = useCallback(
    (tableIndex: number) => {
      const row = Number(prompt(t('docxEditor.prompts.tableRow'), '1'));
      const column = Number(prompt(t('docxEditor.prompts.tableColumn'), '1'));
      const text = prompt(t('docxEditor.prompts.tableText'));
      if (Number.isInteger(row) && Number.isInteger(column) && text !== null)
        void apply({ column: column - 1, row: row - 1, tableIndex, text, type: 'setTableCell' });
    },
    [apply, t],
  );

  if (error && !bytes)
    return <AsyncError error={error} variant={'block'} onRetry={() => void load()} />;
  if (!bytes || !blocks) return <NeuralNetworkLoading size={36} />;

  return (
    <Flexbox className={styles.editor}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={6}>
        <ActionIcon
          disabled={!undoStackRef.current.length}
          icon={Undo2}
          title={t('docxEditor.actions.undo')}
          onClick={() => void undo()}
        />
        <ActionIcon
          disabled={!redoStackRef.current.length}
          icon={Redo2}
          title={t('docxEditor.actions.redo')}
          onClick={() => void redo()}
        />
        <ActionIcon
          icon={Bold}
          title={t('docxEditor.actions.bold')}
          onClick={() =>
            selectedParagraph &&
            void apply({
              bold: !selectedParagraph.bold,
              index: selectedParagraph.index,
              type: 'formatParagraph',
            })
          }
        />
        <select
          aria-label={t('docxEditor.actions.fontFamily')}
          value={selectedParagraph?.fontFamily || ''}
          onChange={(event) =>
            selectedParagraph &&
            event.target.value &&
            void apply({
              fontFamily: event.target.value,
              index: selectedParagraph.index,
              type: 'formatParagraph',
            })
          }
        >
          <option value="">{t('docxEditor.fonts.default')}</option>
          {FONT_FAMILIES.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <select
          aria-label={t('docxEditor.actions.fontSize')}
          value={selectedParagraph?.fontSize || ''}
          onChange={(event) =>
            selectedParagraph &&
            event.target.value &&
            void apply({
              fontSize: Number(event.target.value),
              index: selectedParagraph.index,
              type: 'formatParagraph',
            })
          }
        >
          <option value="">{t('docxEditor.sizes.default')}</option>
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <ActionIcon
          icon={AlignLeft}
          title={t('docxEditor.actions.align.left')}
          onClick={() =>
            selectedParagraph &&
            void apply({ alignment: 'left', index: selectedParagraph.index, type: 'setAlignment' })
          }
        />
        <ActionIcon
          icon={AlignCenter}
          title={t('docxEditor.actions.align.center')}
          onClick={() =>
            selectedParagraph &&
            void apply({
              alignment: 'center',
              index: selectedParagraph.index,
              type: 'setAlignment',
            })
          }
        />
        <ActionIcon
          icon={AlignRight}
          title={t('docxEditor.actions.align.right')}
          onClick={() =>
            selectedParagraph &&
            void apply({ alignment: 'right', index: selectedParagraph.index, type: 'setAlignment' })
          }
        />
        <ActionIcon
          icon={AlignJustify}
          title={t('docxEditor.actions.align.justify')}
          onClick={() =>
            selectedParagraph &&
            void apply({
              alignment: 'justify',
              index: selectedParagraph.index,
              type: 'setAlignment',
            })
          }
        />
        <select
          aria-label={t('docxEditor.actions.style')}
          value={selectedParagraph?.style || 'Normal'}
          onChange={(event) =>
            selectedParagraph &&
            void apply({
              index: selectedParagraph.index,
              style: event.target.value as 'Heading1' | 'Heading2' | 'Heading3' | 'Normal',
              type: 'setParagraphStyle',
            })
          }
        >
          <option value="Normal">{t('docxEditor.styles.normal')}</option>
          <option value="Heading1">{t('docxEditor.styles.heading1')}</option>
          <option value="Heading2">{t('docxEditor.styles.heading2')}</option>
          <option value="Heading3">{t('docxEditor.styles.heading3')}</option>
        </select>
        <ActionIcon
          icon={List}
          title={t('docxEditor.actions.bulletList')}
          onClick={() => toggleList('bullet')}
        />
        <ActionIcon
          icon={ListOrdered}
          title={t('docxEditor.actions.numberedList')}
          onClick={() => toggleList('number')}
        />
        <ActionIcon
          icon={Plus}
          title={t('docxEditor.actions.addParagraph')}
          onClick={() =>
            void apply({
              afterIndex: selectedParagraph?.index ?? lastParagraphIndex,
              text: t('docxEditor.defaults.paragraph'),
              type: 'insertParagraph',
            })
          }
        />
        <ActionIcon
          disabled={!selectedParagraph}
          icon={Copy}
          title={t('docxEditor.actions.copy')}
          onClick={() =>
            selectedParagraph && void navigator.clipboard.writeText(selectedParagraph.text)
          }
        />
        <ActionIcon
          icon={ClipboardPaste}
          title={t('docxEditor.actions.paste')}
          onClick={() => void pasteParagraph().catch(onQueueError)}
        />
        <ActionIcon
          disabled={!selectedBlock}
          icon={Trash2}
          title={t('docxEditor.actions.deleteBlock')}
          onClick={deleteSelected}
        />
        <ActionIcon
          icon={Table2}
          title={t('docxEditor.actions.addTable')}
          onClick={() => void apply({ columns: 3, rows: 3, type: 'appendTable' })}
        />
        <ActionIcon
          icon={Link}
          title={t('docxEditor.actions.addLink')}
          onClick={() => {
            const target = prompt(t('docxEditor.prompts.linkTarget'), 'https://');
            const displayText = target && prompt(t('docxEditor.prompts.linkText'));
            if (target && displayText) void apply({ displayText, target, type: 'appendHyperlink' });
          }}
        />
        <ActionIcon
          icon={ImagePlus}
          title={t('docxEditor.actions.insertImage')}
          onClick={() => {
            imageActionRef.current = { type: 'insert' };
            imageInputRef.current?.click();
          }}
        />
        <input
          hidden
          accept="image/png,image/jpeg"
          ref={imageInputRef}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const action = imageActionRef.current;
            if (file)
              void file.arrayBuffer().then((imageBytes) =>
                apply(
                  action.type === 'replace'
                    ? { bytes: imageBytes, index: action.index, type: 'replaceImage' }
                    : {
                        afterIndex: selectedParagraph?.index,
                        bytes: imageBytes,
                        type: 'insertImage',
                      },
                ),
              );
            event.target.value = '';
          }}
        />
        <Button icon={Save} size={'small'} onClick={save}>
          {t('docxEditor.actions.save')}
        </Button>
        <Button icon={Download} size={'small'} onClick={downloadCurrent}>
          {t('docxEditor.actions.download')}
        </Button>
        <span className={styles.status}>{t(`docxEditor.status.${status}`)}</span>
      </Flexbox>
      {Boolean(error) && (
        <OfficeSaveError error={error} onDownloadRecovery={downloadCurrent} onRetry={save} />
      )}
      <Flexbox align={'center'} className={styles.canvas} gap={8}>
        {blocks.map((block) =>
          block.kind === 'paragraph' ? (
            <div
              className={styles.block}
              data-block-index={block.index}
              data-block-kind="paragraph"
              data-selected={selected.kind === 'paragraph' && selected.index === block.index}
              key={`p-${block.index}`}
              onClick={() => setSelected({ index: block.index, kind: 'paragraph' })}
            >
              <Flexbox horizontal gap={8}>
                {block.list && (
                  <span className={styles.listMarker}>{block.list === 'number' ? '1.' : '•'}</span>
                )}
                <textarea
                  className={styles.input}
                  defaultValue={block.text}
                  key={`${block.index}-${block.text}`}
                  rows={Math.max(1, block.text.split('\n').length)}
                  style={previewStyle(block)}
                  onBlur={(event) => {
                    if (event.target.value !== block.text)
                      void apply({
                        index: block.index,
                        text: event.target.value,
                        type: 'setParagraphText',
                      });
                  }}
                />
              </Flexbox>
              {block.link && (
                <Flexbox horizontal align={'center'} gap={4}>
                  <span className={styles.linkBadge}>{block.link.target}</span>
                  <ActionIcon
                    icon={Pencil}
                    size={'small'}
                    title={t('docxEditor.actions.editLink')}
                    onClick={(event) => {
                      event.stopPropagation();
                      const displayText = prompt(t('docxEditor.prompts.linkText'), block.text);
                      if (displayText && block.link)
                        void apply({
                          displayText,
                          index: block.link.index,
                          type: 'setHyperlinkText',
                        });
                    }}
                  />
                </Flexbox>
              )}
              {block.images?.map((image) => (
                <img
                  alt={t('docxEditor.actions.replaceImage')}
                  className={styles.image}
                  data-image-index={image.index}
                  key={image.index}
                  src={image.src}
                  title={t('docxEditor.actions.replaceImage')}
                  onClick={(event) => {
                    event.stopPropagation();
                    imageActionRef.current = { index: image.index, type: 'replace' };
                    imageInputRef.current?.click();
                  }}
                />
              ))}
            </div>
          ) : (
            <button
              className={`${styles.block} ${styles.table}`}
              data-block-index={block.index}
              data-block-kind="table"
              data-selected={selected.kind === 'table' && selected.index === block.index}
              key={`t-${block.index}`}
              type="button"
              onClick={() => {
                // First click selects the table; clicking again edits its cells.
                if (selected.kind === 'table' && selected.index === block.index)
                  editTableCells(block.index);
                else setSelected({ index: block.index, kind: 'table' });
              }}
            >
              {block.text}
            </button>
          ),
        )}
      </Flexbox>
    </Flexbox>
  );
});

DOCXEditor.displayName = 'DOCXEditor';
export default DOCXEditor;
