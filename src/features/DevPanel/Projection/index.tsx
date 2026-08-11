'use client';

import { Input } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Table2 } from 'lucide-react';
import { memo, useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { createProjectionTableCell } from './model';
import ProjectionInspector from './ProjectionInspector';
import ProjectionTableCell from './ProjectionTableCell';
import {
  type ProjectionCellEditFeedback,
  useProjectionCellEditor,
} from './useProjectionCellEditor';
import { useProjectionInspector } from './useProjectionInspector';

const styles = createStaticStyles(({ css }) => ({
  detailsBody: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
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
  rowActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  sidebarTableCount: css`
    flex-shrink: 0;

    min-width: 24px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusXS};

    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  sidebarTableIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  sidebarTableItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    height: 32px;
    padding-inline: 12px;
    border: 0;

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
  sidebarTableItemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  sidebarTableList: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    padding-block: 4px;
  `,
  sidebarTableName: css`
    overflow: hidden;
    flex: 1;

    font-family: ${cssVar.fontFamilyCode};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sidebarTablesPane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  table: css`
    table-layout: fixed;
    border-spacing: 0;
    border-collapse: separate;
    width: 100%;

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
  `,
  toolbarSearch: css`
    min-width: 140px;
    max-width: 320px;
  `,
  toolbarTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 100px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  editFeedback: css`
    overflow: hidden;
    flex: 1;

    padding-inline: 12px;

    color: ${cssVar.colorTextTertiary};
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  editFeedbackError: css`
    color: ${cssVar.colorError};
  `,
  editFeedbackSaved: css`
    color: ${cssVar.colorSuccess};
  `,
  workspace: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: 220px minmax(400px, 1fr) 340px;
    flex: 1;

    min-height: 0;

    @media (width <= 1200px) {
      grid-template-columns: 190px minmax(360px, 1fr) 300px;
    }

    @media (width <= 900px) {
      grid-template-columns: 180px minmax(0, 1fr);
    }

    @media (width <= 560px) {
      grid-template-columns: 140px minmax(0, 1fr);
    }
  `,
}));

const MAX_RENDERED_ROWS = 300;

const ProjectionPanel = memo(() => {
  const {
    columns,
    matchingRows,
    rowSearch,
    selectRecord,
    selectTable,
    selectedRow,
    selectedTable,
    setRowSearch,
    setTableSearch,
    tableSearch,
    visibleTables,
  } = useProjectionInspector();
  const [editFeedback, setEditFeedback] = useState<ProjectionCellEditFeedback | null>(null);
  const cellEditor = useProjectionCellEditor({ onFeedback: setEditFeedback });
  const renderedRows = matchingRows.slice(0, MAX_RENDERED_ROWS);
  const tableMinWidth = Math.max(
    900,
    columns.reduce((total, { width }) => total + width, 0),
  );
  const rowRange =
    matchingRows.length === 0
      ? '0 rows'
      : `1–${renderedRows.length} of ${matchingRows.length} rows`;

  return (
    <div className={devDockPanelStyles.root}>
      <div className={styles.workspace}>
        <aside
          aria-label={'Projection tables'}
          className={cx(styles.sidebarTablesPane, devDockPanelStyles.paneDividerEnd)}
        >
          <div className={devDockPanelStyles.paneHeader}>Tables</div>
          <div className={devDockPanelStyles.paneSearch}>
            <Input
              allowClear
              className={devDockPanelStyles.searchInput}
              placeholder={'Search tables…'}
              size={'small'}
              value={tableSearch}
              variant={'borderless'}
              onChange={(event) => setTableSearch(event.target.value)}
            />
          </div>
          <div className={styles.sidebarTableList}>
            {visibleTables.length === 0 ? (
              <div className={styles.empty}>No tables match.</div>
            ) : (
              visibleTables.map(({ id, label, rowCount }) => (
                <button
                  aria-pressed={id === selectedTable?.id}
                  key={id}
                  title={label}
                  type={'button'}
                  className={cx(
                    styles.sidebarTableItem,
                    id === selectedTable?.id && styles.sidebarTableItemActive,
                  )}
                  onClick={() => {
                    void cellEditor.commit().then((committed) => {
                      if (committed) {
                        setEditFeedback(null);
                        selectTable(id);
                      }
                    });
                  }}
                >
                  <Table2 className={styles.sidebarTableIcon} size={14} />
                  <span className={styles.sidebarTableName}>{label}</span>
                  <span className={styles.sidebarTableCount}>{rowCount}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className={styles.tablePane}>
          <div className={devDockPanelStyles.toolbar}>
            <span className={styles.toolbarTitle} title={selectedTable?.label}>
              {selectedTable?.label ?? 'Projection'}
            </span>
            <Input
              allowClear
              className={styles.toolbarSearch}
              disabled={!selectedTable}
              placeholder={'Search rows…'}
              size={'small'}
              value={rowSearch}
              onChange={(event) => setRowSearch(event.target.value)}
            />
            <span className={styles.toolbarMeta}>{matchingRows.length} rows</span>
            <span className={styles.toolbarMeta}>live store</span>
          </div>
          <div className={styles.tableScroll} key={selectedTable?.id}>
            <table className={styles.table} style={{ minWidth: tableMinWidth }}>
              <colgroup>
                {columns.map((column) => (
                  <col key={column.id} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.id} scope={'col'}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => {
                  const active = row.rowKey === selectedRow?.rowKey;
                  return (
                    <tr
                      aria-label={`${row.scope}/${row.identity}`}
                      aria-selected={active}
                      className={active ? styles.rowActive : undefined}
                      key={row.rowKey}
                      tabIndex={0}
                      onClick={() => {
                        void cellEditor.commit().then((committed) => {
                          if (committed) {
                            setEditFeedback(null);
                            selectRecord(row.rowKey);
                          }
                        });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void cellEditor.commit().then((committed) => {
                            if (committed) {
                              setEditFeedback(null);
                              selectRecord(row.rowKey);
                            }
                          });
                        }
                      }}
                    >
                      {columns.map((column) => {
                        const cell = createProjectionTableCell(row, column);
                        return (
                          <ProjectionTableCell cell={cell} editor={cellEditor} key={cell.key} />
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {matchingRows.length === 0 && (
              <div className={styles.empty}>
                {rowSearch
                  ? `No rows match “${rowSearch}”.`
                  : selectedTable
                    ? 'This table has no rows.'
                    : 'Open a surface that hydrates Projection data.'}
              </div>
            )}
          </div>
          <div className={devDockPanelStyles.statusBar}>
            <span>{rowRange}</span>
            <span
              title={editFeedback?.message}
              className={cx(
                styles.editFeedback,
                editFeedback?.status === 'error' && styles.editFeedbackError,
                editFeedback?.status === 'saved' && styles.editFeedbackSaved,
              )}
            >
              {editFeedback?.message ?? 'Double-click a data cell to edit.'}
            </span>
            <span>Projection Store</span>
          </div>
        </main>

        <aside
          aria-label={'Selected Projection row'}
          className={cx(styles.detailsPane, devDockPanelStyles.paneDividerStart)}
        >
          <div className={devDockPanelStyles.paneHeader}>Record</div>
          {selectedRow ? (
            <div className={styles.detailsBody}>
              <ProjectionInspector editor={cellEditor} row={selectedRow} table={selectedTable} />
            </div>
          ) : (
            <div className={styles.empty}>Select a Projection row.</div>
          )}
        </aside>
      </div>
    </div>
  );
});

ProjectionPanel.displayName = 'DevProjectionPanel';

export default ProjectionPanel;
