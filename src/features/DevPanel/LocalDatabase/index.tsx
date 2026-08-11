'use client';

import { Input } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { RefreshCw, Table2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import { inspectManagedProjection } from '@/projection/devtools';
import { PROJECTION_COLLECTIONS } from '@/projection/persistence/repository';

import ProjectionEditor from '../Projection/ProjectionEditor';
import {
  createLocalDatabaseTableRows,
  filterLocalDatabaseFields,
  filterLocalDatabaseRows,
  formatLocalDatabaseCellValue,
  formatLocalDatabaseFieldValue,
  getLocalDatabaseColumns,
  type LocalDatabaseColumn,
} from './model';
import { useLocalDatabaseInspector } from './useLocalDatabaseInspector';

const MAX_RENDERED_ROWS = 300;
const EMPTY_COLUMNS: LocalDatabaseColumn[] = [
  { id: '__key', label: 'key' },
  { id: 'value', label: 'value' },
];

const styles = createStaticStyles(({ css }) => ({
  collectionCount: css`
    flex-shrink: 0;

    min-width: 24px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusXS};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  collectionIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  collectionItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    height: 32px;
    padding-inline: 12px;
    border: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  collectionItemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  collectionList: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    padding-block: 4px;
  `,
  collectionName: css`
    overflow: hidden;
    flex: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  collectionsPane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  detailField: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  detailFields: css`
    overflow: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  detailLabel: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  detailType: css`
    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
  `,
  detailValue: css`
    overflow: auto;

    min-height: 28px;
    max-height: 180px;
    margin: 0;
    padding-block: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.6;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  detailsPane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;

    @media (width <= 900px) {
      display: none;
    }
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 0;
    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  error: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    min-height: 0;
    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorError};
    text-align: center;
  `,
  managedWarning: css`
    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorErrorBorder};

    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  table: css`
    table-layout: fixed;
    border-spacing: 0;
    border-collapse: separate;

    th,
    td {
      overflow: hidden;

      height: 32px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

      font-family: ${cssVar.fontFamilyCode};
      font-size: ${cssVar.fontSizeSM};
      color: ${cssVar.colorTextSecondary};
      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      font-family: ${cssVar.fontFamily};
      font-weight: 600;
      color: ${cssVar.colorText};

      background: ${cssVar.colorBgContainer};
    }

    th:last-child,
    td:last-child {
      border-inline-end: 0;
    }

    tbody tr {
      cursor: pointer;
      outline: none;
    }

    tbody tr:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    tbody tr:focus-visible {
      box-shadow: inset 0 0 0 2px ${cssVar.colorPrimary};
    }
  `,
  tableEmpty: css`
    position: absolute;
    inset-block: 32px 0;
    inset-inline: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  tableName: css`
    overflow: hidden;
    flex-shrink: 1;

    min-width: 100px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tablePane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  tableScroll: css`
    position: relative;
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  toolbarMeta: css`
    flex-shrink: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    @media (width <= 1100px) {
      display: none;
    }
  `,
  toolbarSearch: css`
    min-width: 120px;
    max-width: 300px;
  `,
  workspace: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: 220px minmax(360px, 1fr) 300px;
    flex: 1;

    min-height: 0;

    @media (width <= 1200px) {
      grid-template-columns: 190px minmax(360px, 1fr) 260px;
    }

    @media (width <= 900px) {
      grid-template-columns: 170px minmax(0, 1fr);
    }

    @media (width <= 560px) {
      grid-template-columns: 140px minmax(0, 1fr);
    }
  `,
}));

const columnWidth = ({ label }: LocalDatabaseColumn): number => {
  if (label === 'key') return 260;
  if (label === 'id') return 220;
  if (label === 'kind') return 120;
  if (label === 'schemaVersion') return 120;
  return 240;
};

const LocalDatabasePanel = memo(() => {
  const { collections, entries, error, isLoading, refresh, selectCollection, selectedCollection } =
    useLocalDatabaseInspector();
  const [collectionSearch, setCollectionSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const tableRows = useMemo(() => createLocalDatabaseTableRows(entries), [entries]);
  const columns = useMemo(() => {
    const resolvedColumns = getLocalDatabaseColumns(tableRows);
    return resolvedColumns.length > 0 ? resolvedColumns : EMPTY_COLUMNS;
  }, [tableRows]);
  const matchingRows = useMemo(
    () => filterLocalDatabaseRows(tableRows, rowSearch),
    [rowSearch, tableRows],
  );
  const renderedRows = matchingRows.slice(0, MAX_RENDERED_ROWS);
  const selectedRow =
    renderedRows.find(({ entry }) => entry.key === selectedKey) ?? renderedRows.at(0);
  const visibleFields = useMemo(
    () => filterLocalDatabaseFields(selectedRow?.fields ?? [], fieldSearch),
    [fieldSearch, selectedRow],
  );
  const projectionInspection = useMemo(
    () =>
      selectedCollection === PROJECTION_COLLECTIONS.records && selectedRow
        ? inspectManagedProjection(selectedRow.entry)
        : null,
    [selectedCollection, selectedRow],
  );
  const visibleCollections = useMemo(() => {
    const term = collectionSearch.trim().toLowerCase();
    return term ? collections.filter(({ name }) => name.toLowerCase().includes(term)) : collections;
  }, [collectionSearch, collections]);
  const tableWidth = columns.reduce((total, column) => total + columnWidth(column), 0);
  const rowRange =
    matchingRows.length === 0
      ? '0 rows'
      : `1–${renderedRows.length} of ${matchingRows.length} rows`;

  if (error) {
    return (
      <div className={devDockPanelStyles.root}>
        <div className={styles.error}>
          <span>Could not read the local database: {error}</span>
          <Button size={'small'} onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading && collections.length === 0) {
    return (
      <div className={devDockPanelStyles.root}>
        <div className={styles.empty}>
          <NeuralNetworkLoading size={24} />
        </div>
      </div>
    );
  }

  return (
    <div className={devDockPanelStyles.root}>
      <div className={styles.workspace}>
        <aside
          aria-label={'Database collections'}
          className={cx(styles.collectionsPane, devDockPanelStyles.paneDividerEnd)}
        >
          <div className={devDockPanelStyles.paneHeader}>Collections</div>
          <div className={devDockPanelStyles.paneSearch}>
            <Input
              allowClear
              className={devDockPanelStyles.searchInput}
              placeholder={'Search collections…'}
              size={'small'}
              value={collectionSearch}
              variant={'borderless'}
              onChange={(event) => setCollectionSearch(event.target.value)}
            />
          </div>
          <div className={styles.collectionList}>
            {visibleCollections.length === 0 ? (
              <div className={styles.empty}>
                {collectionSearch ? 'No collections match.' : 'No collections.'}
              </div>
            ) : (
              visibleCollections.map(({ entryCount, name }) => {
                const active = name === selectedCollection;

                return (
                  <button
                    aria-pressed={active}
                    className={cx(styles.collectionItem, active && styles.collectionItemActive)}
                    key={name}
                    title={name}
                    type={'button'}
                    onClick={() => {
                      setFieldSearch('');
                      setRowSearch('');
                      setSelectedKey(null);
                      void selectCollection(name);
                    }}
                  >
                    <Table2 className={styles.collectionIcon} size={14} />
                    <span className={styles.collectionName}>{name}</span>
                    <span className={styles.collectionCount}>{entryCount}</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className={styles.tablePane}>
          <div className={devDockPanelStyles.toolbar}>
            <span className={styles.tableName} title={selectedCollection ?? undefined}>
              {selectedCollection ?? 'Local Database'}
            </span>
            <Input
              allowClear
              className={styles.toolbarSearch}
              placeholder={'Search rows…'}
              size={'small'}
              style={{ flex: 1 }}
              value={rowSearch}
              onChange={(event) => setRowSearch(event.target.value)}
            />
            <span className={styles.toolbarMeta}>{entries.length} rows</span>
            <span className={styles.toolbarMeta}>
              {selectedCollection === PROJECTION_COLLECTIONS.records
                ? 'projection edit'
                : 'read-only'}
            </span>
            <Button
              icon={RefreshCw}
              loading={isLoading}
              size={'small'}
              type={'text'}
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
          </div>
          <div className={styles.tableScroll}>
            <table
              className={styles.table}
              style={{ minWidth: '100%', width: Math.max(tableWidth, 640) }}
            >
              <colgroup>
                {columns.map((column) => (
                  <col key={column.id} style={{ width: columnWidth(column) }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.id} scope={'col'} title={column.label}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => {
                  const active = row.entry.key === selectedRow?.entry.key;

                  return (
                    <tr
                      aria-label={row.entry.key}
                      aria-selected={active}
                      className={active ? styles.rowActive : undefined}
                      key={row.entry.key}
                      tabIndex={0}
                      onClick={() => setSelectedKey(row.entry.key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedKey(row.entry.key);
                        }
                      }}
                    >
                      {columns.map((column) => {
                        const field = row.fields.find(({ id }) => id === column.id);
                        const text = formatLocalDatabaseCellValue(field?.value);

                        return (
                          <td key={column.id} title={text}>
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {renderedRows.length === 0 && (
              <div className={styles.tableEmpty}>
                {rowSearch
                  ? `No rows match “${rowSearch}”.`
                  : selectedCollection
                    ? 'This collection is empty.'
                    : 'No persisted records.'}
              </div>
            )}
          </div>
          <div className={devDockPanelStyles.statusBar}>
            <span>{rowRange}</span>
            {matchingRows.length > MAX_RENDERED_ROWS && (
              <span>Refine the search to inspect later rows.</span>
            )}
          </div>
        </main>

        <aside
          aria-label={'Selected record details'}
          className={cx(styles.detailsPane, devDockPanelStyles.paneDividerStart)}
        >
          <div className={devDockPanelStyles.paneHeader}>Details</div>
          <div className={devDockPanelStyles.paneSearch}>
            <Input
              allowClear
              className={devDockPanelStyles.searchInput}
              disabled={!selectedRow}
              placeholder={'Search fields…'}
              size={'small'}
              value={fieldSearch}
              variant={'borderless'}
              onChange={(event) => setFieldSearch(event.target.value)}
            />
          </div>
          {selectedRow ? (
            <div className={styles.detailFields}>
              {projectionInspection?.status === 'editable' && (
                <ProjectionEditor
                  key={projectionInspection.projection.entryKey}
                  projection={projectionInspection.projection}
                  onPersisted={refresh}
                />
              )}
              {projectionInspection?.status === 'invalid' && (
                <div className={styles.managedWarning}>{projectionInspection.reason}</div>
              )}
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
      </div>
    </div>
  );
});

LocalDatabasePanel.displayName = 'DevLocalDatabasePanel';

export default LocalDatabasePanel;
