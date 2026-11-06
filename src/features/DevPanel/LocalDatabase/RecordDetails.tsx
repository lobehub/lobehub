'use client';

import { Input } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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
      {...stylex.props(styles.detailsPane, devDockPanelStyles.paneDividerStart)}
    >
      <div {...stylex.props(devDockPanelStyles.paneHeader)}>Details</div>
      <div {...stylex.props(devDockPanelStyles.paneSearch)}>
        <Input
          allowClear
          className={stylex.props(devDockPanelStyles.searchInput).className}
          disabled={!row}
          placeholder={'Search fields…'}
          size={'small'}
          value={search}
          variant={'borderless'}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {row ? (
        <div {...stylex.props(styles.detailFields)}>
          {visibleFields.length === 0 ? (
            <div {...stylex.props(styles.empty)}>No fields match.</div>
          ) : (
            visibleFields.map((field) => (
              <div {...stylex.props(styles.detailField)} key={field.id}>
                <div {...stylex.props(styles.detailLabel)}>
                  <span>{field.label}</span>
                  <span {...stylex.props(styles.detailType)}>{field.type}</span>
                </div>
                <pre {...stylex.props(styles.detailValue)}>
                  {formatLocalDatabaseFieldValue(field.value)}
                </pre>
              </div>
            ))
          )}
        </div>
      ) : (
        <div {...stylex.props(styles.empty)}>Select a row to inspect its fields.</div>
      )}
    </aside>
  );
};

export default RecordDetails;
