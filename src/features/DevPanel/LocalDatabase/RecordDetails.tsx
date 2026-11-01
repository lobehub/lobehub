'use client';

import { cx, Input } from '@lobehub/ui';
import { useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import {
  filterLocalDatabaseFields,
  formatLocalDatabaseFieldValue,
  type LocalDatabaseTableRow,
} from './model';

interface RecordDetailsProps {
  row: LocalDatabaseTableRow | undefined;
}

const RecordDetails = ({ row }: RecordDetailsProps) => {
  const [search, setSearch] = useState('');
  const visibleFields = filterLocalDatabaseFields(row?.fields ?? [], search);

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
          disabled={!row}
          placeholder={'Search fields…'}
          size={'small'}
          value={search}
          variant={'borderless'}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {row ? (
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
                <pre className={styles.detailValue}>
                  {formatLocalDatabaseFieldValue(field.value)}
                </pre>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className={styles.empty}>Select a row to inspect its fields.</div>
      )}
    </aside>
  );
};

export default RecordDetails;
