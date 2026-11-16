'use client';

import { cx, Input, Spin } from '@lobehub/ui';
import { useMemo, useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import type { LocalDatabaseEntry } from '@/libs/localDatabase';

import { inspectorStyles as styles } from '../inspectorStyles';
import {
  filterLocalDatabaseFields,
  formatLocalDatabaseFieldValue,
  getLocalDatabaseFields,
  parseReplicaStorageKey,
} from './model';

const MAX_VALUE_CHARS = 20_000;

interface RecordDetailsProps {
  entry: LocalDatabaseEntry | null;
  isLoading: boolean;
  selectedKey: string | null;
}

const clip = (text: string): string =>
  text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}\n… ${text.length - MAX_VALUE_CHARS} more characters`
    : text;

const RecordDetails = ({ entry, isLoading, selectedKey }: RecordDetailsProps) => {
  const [search, setSearch] = useState('');
  // A single persisted value can be several MB; serialize it once per record, not per keystroke.
  const fields = useMemo(
    () =>
      entry
        ? getLocalDatabaseFields(entry, parseReplicaStorageKey(entry.key)).map((field) => ({
            ...field,
            text: clip(formatLocalDatabaseFieldValue(field.value)),
          }))
        : [],
    [entry],
  );
  const visibleFields = useMemo(() => filterLocalDatabaseFields(fields, search), [fields, search]);

  const renderBody = () => {
    if (selectedKey === null) {
      return <div className={styles.empty}>Select a row to load its value.</div>;
    }

    if (!entry) {
      return (
        <div className={styles.empty}>{isLoading ? <Spin /> : 'This record no longer exists.'}</div>
      );
    }

    return (
      <div className={styles.detailFields}>
        {visibleFields.length === 0 ? (
          <div className={styles.empty}>No fields match.</div>
        ) : (
          visibleFields.map((field) => (
            <div className={styles.detailField} key={field.id}>
              <div className={styles.detailLabel}>
                <span>{field.label}</span>
                <span className={styles.detailType}>{field.type}</span>
              </div>
              <pre className={styles.detailValue}>{field.text}</pre>
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <aside
      aria-label={'Selected record details'}
      className={cx(styles.detailsPane, devDockPanelStyles.paneDividerStart)}
    >
      <div className={devDockPanelStyles.paneHeader}>Details</div>
      <div className={devDockPanelStyles.paneSearch}>
        <Input
          allowClear
          className={devDockPanelStyles.searchInput}
          disabled={!entry}
          placeholder={'Search fields…'}
          size={'small'}
          value={search}
          variant={'borderless'}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {renderBody()}
    </aside>
  );
};

export default RecordDetails;
