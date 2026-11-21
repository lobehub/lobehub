'use client';

import { Button, cx, Switch, TextArea } from '@lobehub/ui';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import type { ReplicaDevtoolsEntry } from '@/libs/replica/devtools';

import { inspectorStyles as styles } from '../inspectorStyles';
import { type ReplicaEntryRow, serializeReplicaDraft } from './model';
import { replicaStyles } from './styles';
import { useEntryEditor } from './useEntryEditor';

const MAX_PREVIEW_LENGTH = 100_000;

interface EntryDetailsProps {
  entry: ReplicaDevtoolsEntry | undefined;
  onPin: (key: string) => void;
  row: ReplicaEntryRow | undefined;
}

const preview = (value: unknown): string => {
  if (value === undefined) return '—';
  try {
    const text = serializeReplicaDraft(value);
    return text.length > MAX_PREVIEW_LENGTH
      ? `${text.slice(0, MAX_PREVIEW_LENGTH)}\n… truncated (${text.length} chars); use Edit to see all`
      : text;
  } catch (error) {
    return `[Unable to serialize: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

const Field = ({ label, type, value }: { label: string; type?: string; value: string }) => (
  <div className={styles.detailField}>
    <div className={styles.detailLabel}>
      <span>{label}</span>
      {type && <span className={styles.detailType}>{type}</span>}
    </div>
    <pre className={styles.detailValue}>{value}</pre>
  </div>
);

const EntryDetails = ({ entry, onPin, row }: EntryDetailsProps) => {
  const editor = useEntryEditor(entry, row?.key);

  return (
    <aside
      aria-label={'Selected entry details'}
      className={cx(styles.detailsPane, devDockPanelStyles.paneDividerStart)}
    >
      <div className={devDockPanelStyles.paneHeader}>Entry</div>
      {entry && row ? (
        <>
          <div className={replicaStyles.actions}>
            <Button
              disabled={editor.isEditing}
              icon={Pencil}
              size={'small'}
              type={'text'}
              onClick={() => {
                onPin(row.key);
                editor.start();
              }}
            >
              Edit
            </Button>
            <Button
              icon={RefreshCw}
              size={'small'}
              title={'Re-run the mounted useSync query of this entry'}
              type={'text'}
              onClick={() => void entry.revalidate(row.key)}
            >
              Revalidate
            </Button>
            <Button
              danger
              icon={Trash2}
              size={'small'}
              title={'slice.remove: drops the entry and every persisted query variant of the key'}
              type={'text'}
              onClick={() => entry.remove(row.key)}
            >
              Remove
            </Button>
          </div>
          {editor.isEditing ? (
            <div className={replicaStyles.editor}>
              <TextArea
                resize
                aria-label={`Edit ${row.key} as JSON`}
                className={replicaStyles.editorInput}
                spellCheck={false}
                value={editor.draft ?? ''}
                onChange={(event) => editor.setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') editor.cancel();
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) editor.apply();
                }}
              />
              {editor.error && <div className={replicaStyles.editorError}>{editor.error}</div>}
              <div className={replicaStyles.editorFooter}>
                <label className={replicaStyles.persistToggle}>
                  <Switch checked={editor.persist} size={'small'} onChange={editor.setPersist} />
                  Persist
                </label>
                <span>
                  <Button size={'small'} type={'text'} onClick={editor.cancel}>
                    Cancel
                  </Button>
                  <Button size={'small'} type={'primary'} onClick={editor.apply}>
                    Apply
                  </Button>
                </span>
              </div>
            </div>
          ) : (
            <div className={styles.detailFields}>
              {editor.error && <Field label={'error'} value={editor.error} />}
              <Field label={'key'} value={row.key} />
              <Field label={'source'} value={row.source} />
              <Field label={'query'} value={row.query ?? '—'} />
              <Field
                label={'pending'}
                type={row.hasBase ? 'over base' : undefined}
                value={String(row.pending)}
              />
              <Field label={'updatedAt'} value={row.updatedAt?.toISOString() ?? '—'} />
              {row.params !== undefined && <Field label={'params'} value={preview(row.params)} />}
              <Field label={'value'} value={preview(row.data)} />
            </div>
          )}
        </>
      ) : (
        <div className={styles.empty}>Select an entry to inspect it.</div>
      )}
    </aside>
  );
};

export default EntryDetails;
