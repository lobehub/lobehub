'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Download,
  ImagePlus,
  Link,
  List,
  ListOrdered,
  Plus,
  Redo2,
  Save,
  Table2,
  Undo2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

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

const DOCXEditor = memo<DOCXEditorProps>(({ fileId, fileName, url }) => {
  const { t } = useTranslation('file');
  const undoRef = useRef<ArrayBuffer[]>([]);
  const redoRef = useRef<ArrayBuffer[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [blocks, setBlocks] = useState<DocxBlock[]>();
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved');

  const refresh = useCallback(async (next: ArrayBuffer) => {
    setBytes(next);
    setBlocks(await inspectDocx(next));
  }, []);

  const load = useCallback(async () => {
    setError(undefined);
    const draft = await loadDocxDraft(fileId, url);
    const source = draft || (await (await fetch(url)).arrayBuffer());
    await refresh(source);
    setStatus(draft ? 'unsaved' : 'saved');
  }, [fileId, refresh, url]);

  useEffect(() => {
    void load().catch(setError);
  }, [load]);

  const apply = useCallback(
    async (operation: DocxEditOperation) => {
      if (!bytes) return;
      undoRef.current.push(bytes);
      redoRef.current = [];
      setStatus('saving');
      try {
        const next = await editDocx(bytes, operation);
        await refresh(next);
        await saveDocxDraft(fileId, url, next);
        setStatus('unsaved');
      } catch (cause) {
        undoRef.current.pop();
        setStatus('failed');
        setError(cause);
      }
    },
    [bytes, fileId, refresh, url],
  );

  const restore = useCallback(
    async (next: ArrayBuffer) => {
      setStatus('saving');
      await refresh(next);
      await saveDocxDraft(fileId, url, next);
      setStatus('unsaved');
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

  const selectedParagraph = blocks?.find(
    (block) => block.kind === 'paragraph' && block.index === selected,
  );
  if (error && !bytes)
    return <AsyncError error={error} variant={'block'} onRetry={() => void load()} />;
  if (!bytes || !blocks) return <NeuralNetworkLoading size={36} />;

  return (
    <Flexbox className={styles.editor}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={6}>
        <ActionIcon
          disabled={!undoRef.current.length}
          icon={Undo2}
          title={t('docxEditor.actions.undo')}
          onClick={() => void undo()}
        />
        <ActionIcon
          disabled={!redoRef.current.length}
          icon={Redo2}
          title={t('docxEditor.actions.redo')}
          onClick={() => void redo()}
        />
        <ActionIcon
          icon={Bold}
          title={t('docxEditor.actions.bold')}
          onClick={() =>
            selectedParagraph &&
            void apply({ bold: true, index: selectedParagraph.index, type: 'formatParagraph' })
          }
        />
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
          icon={Plus}
          title={t('docxEditor.actions.addParagraph')}
          onClick={() =>
            void apply({
              afterIndex:
                selectedParagraph?.index ??
                blocks.filter((block) => block.kind === 'paragraph').length - 1,
              text: t('docxEditor.defaults.paragraph'),
              type: 'insertParagraph',
            })
          }
        />
        <ActionIcon
          icon={ListOrdered}
          title={t('docxEditor.actions.numberedList')}
          onClick={() =>
            void apply({
              afterIndex: selectedParagraph?.index ?? 0,
              list: 'number',
              text: t('docxEditor.defaults.listItem'),
              type: 'insertParagraph',
            })
          }
        />
        <ActionIcon
          icon={List}
          title={t('docxEditor.actions.bulletList')}
          onClick={() =>
            void apply({
              afterIndex: selectedParagraph?.index ?? 0,
              list: 'bullet',
              text: t('docxEditor.defaults.listItem'),
              type: 'insertParagraph',
            })
          }
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
          title={t('docxEditor.actions.replaceImage')}
          onClick={() => imageInputRef.current?.click()}
        />
        <input
          hidden
          accept="image/*"
          ref={imageInputRef}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              void file
                .arrayBuffer()
                .then((imageBytes) => apply({ bytes: imageBytes, index: 0, type: 'replaceImage' }));
            event.target.value = '';
          }}
        />
        <Button
          icon={Save}
          size={'small'}
          onClick={() => {
            setStatus('saving');
            void saveDocxDraft(fileId, url, bytes).then(
              () => setStatus('saved'),
              () => setStatus('failed'),
            );
          }}
        >
          {t('docxEditor.actions.save')}
        </Button>
        <Button icon={Download} size={'small'} onClick={() => download(bytes, fileName)}>
          {t('docxEditor.actions.download')}
        </Button>
        <span className={styles.status}>{t(`docxEditor.status.${status}`)}</span>
      </Flexbox>
      {Boolean(error) && (
        <AsyncError error={error} variant={'block'} onRetry={() => setError(undefined)} />
      )}
      <Flexbox align={'center'} className={styles.canvas} gap={8}>
        {blocks.map((block) =>
          block.kind === 'paragraph' ? (
            <div
              className={styles.block}
              data-selected={selected === block.index}
              key={`p-${block.index}`}
              onClick={() => setSelected(block.index)}
            >
              <textarea
                className={styles.input}
                defaultValue={block.text}
                key={`${block.index}-${block.text}`}
                rows={Math.max(1, block.text.split('\n').length)}
                onBlur={(event) => {
                  if (event.target.value !== block.text)
                    void apply({
                      index: block.index,
                      text: event.target.value,
                      type: 'setParagraphText',
                    });
                }}
              />
            </div>
          ) : (
            <button
              className={`${styles.block} ${styles.table}`}
              key={`t-${block.index}`}
              type="button"
              onClick={() => {
                const row = Number(prompt(t('docxEditor.prompts.tableRow'), '1'));
                const column = Number(prompt(t('docxEditor.prompts.tableColumn'), '1'));
                const text = prompt(t('docxEditor.prompts.tableText'));
                if (Number.isInteger(row) && Number.isInteger(column) && text !== null)
                  void apply({
                    column: column - 1,
                    row: row - 1,
                    tableIndex: block.index,
                    text,
                    type: 'setTableCell',
                  });
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
